// Defensive: Removed legacy delete-slide button logic (no such element in DOM)
// Mode-select handler is initialized below `refresh()` (see initModeSelect),
// so currentSectionId / htmlMode / show- and load- helpers are all in scope
// and the iframe canvas is already populated by the time mode applies.
// Main controller for edit.html.
// Owns: passphrase gate, slide list (incl. DnD reorder), iframe canvas
// switching, props panel, add/delete, frame_html modal, IPC with iframe.
import { ensureAuthed } from "./auth.js";
import { exportHtml, exportNotesMd, exportPdf } from "./export.js";
import { HistoryUI, saveVersionPrompt } from "./history-ui.js";
import * as deckRepo from "./repo/deck-repo.js";
import * as notesRepo from "./repo/notes-repo.js";
import * as slideRepo from "./repo/slide-repo.js";
import * as storageRepo from "./repo/storage-repo.js";
import { bindShortcutsHelp } from "./shortcuts-help.js";

bindShortcutsHelp("Edit", [
  { keys: ["E"], desc: "Toggle edit mode (canvas)" },
  { keys: ["M"], desc: "Toggle raw HTML mode" },
  { keys: ["H"], desc: "Toggle history drawer" },
  { keys: ["I"], desc: "Open image library" },
  { keys: ["⌘S", "Ctrl+S"], desc: "Save version (manual snapshot)" },
  { keys: ["?"], desc: "This help" },
  { keys: ["Click"], desc: "Select slide in list" },
  { keys: ["Drag"], desc: "Reorder slides in list" },
]);

// ── auth gate ──────────────────────────────────────────────────────
if (!ensureAuthed()) {
  document.body.innerHTML =
    '<p style="padding:2rem;color:#ef4444;font-family:monospace">' +
    "Edit access denied.</p>";
  throw new Error("auth failed");
}

const params = new URLSearchParams(location.search);
const deckId = params.get("deck");
if (!deckId) {
  document.body.innerHTML =
    '<p style="padding:2rem;color:#ef4444">Missing ?deck=&lt;deck_id&gt;</p>';
  throw new Error("no deck");
}

// ── state ──────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
let deck = null;
let slides = [];
let notes = new Map(); // sid → content string (populated at load, kept current by mutations)
let currentSectionId = null;
let editMode = true;
let htmlMode = false; // raw <section>…</section> edit in textarea
// Auto-save toggle. Persisted in localStorage so it survives reloads.
// When OFF, debounced timers are NOT scheduled in any input handler — edits
// stay buffered in *Pending and are only flushed by the manual Save button
// or by `flushAllPending()` (e.g., on slide switch / beforeunload).
let autoSave = localStorage.getItem("slidesEditor.autoSave") !== "false";

// Tiny helper: find a slide object by section_id.
function slideOf(sid) {
  return slides.find((s) => s.section_id === sid) || null;
}

// ── ui helpers ─────────────────────────────────────────────────────
function toast(msg, kind = "") {
  const t = $("toast");
  t.textContent = msg;
  t.className = "show " + kind;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.className = ""), 2200);
}
function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}
function setStatus(text, kind = "") {
  const el = $("status");
  el.textContent = text;
  el.dataset.kind = kind;
}

// ── load + render ──────────────────────────────────────────────────
async function refresh({ keepIframe = false } = {}) {
  try {
    let allNotes;
    [deck, slides, allNotes] = await Promise.all([
      deckRepo.getDeck(deckId),
      slideRepo.listByDeck(deckId),
      notesRepo.listByDeck(deckId),
    ]);
    // Populate notes cache from the full fetch.
    notes.clear();
    for (const n of allNotes) {
      notes.set(n.section_id, n.content ?? "");
    }
  } catch (err) {
    setStatus("load failed", "err");
    toast("Load failed: " + err.message, "err");
    return;
  }
  $("deck-title").textContent = deck.title || deckId;
  $("present-link").href = `./present.html?deck=${encodeURIComponent(deckId)}`;
  $("script-link").href = `./script.html?deck=${encodeURIComponent(deckId)}`;
  $("notes-fullscreen-link").href =
    `./script-edit.html?deck=${encodeURIComponent(deckId)}`;
  $("export-notes-link").href =
    `./notes.html?deck=${encodeURIComponent(deckId)}`;
  document.title = `Edit · ${deck.title || deckId}`;

  if (
    !currentSectionId ||
    !slides.find((s) => s.section_id === currentSectionId)
  ) {
    currentSectionId = slides[0]?.section_id || null;
  }
  renderSlideList();
  renderProps();
  loadNotesForCurrent(); // now reads from cache — synchronous, no await needed
  if (!keepIframe) showSlide(currentSectionId);
}

function renderSlideList() {
  const list = $("slide-list");
  list.innerHTML =
    slides
      .map(
        (s, i) => `
    <div class="slide-item ${s.section_id === currentSectionId ? "active" : ""}"
         draggable="true" data-section-id="${escapeHtml(s.section_id)}">
      <span class="order">${i + 1}</span>
      <span class="title">${escapeHtml(s.title || s.section_id)}</span>
      <span class="slide-actions">
        <details class="dropdown slide-dropdown" style="display:inline-block;">
          <summary class="btn" style="padding:0 8px;min-width:32px;text-align:center;">…</summary>
          <div class="dropdown-menu" style="min-width:80px;right:0;left:auto;">
            <button class="slide-action-duplicate" data-section-id="${escapeHtml(s.section_id)}">Duplicate</button>
            <button class="slide-action-delete" data-section-id="${escapeHtml(s.section_id)}">Delete</button>
          </div>
        </details>
      </span>
    </div>`,
      )
      .join("") + '<button id="add-slide">+ New slide</button>';

  list.querySelectorAll(".slide-item").forEach((el) => {
    // Only switch slide if not clicking on an action button (edit/delete)
    el.addEventListener("click", (evt) => {
      if (
        evt.target.closest(".slide-action-duplicate") ||
        evt.target.closest(".slide-action-delete") ||
        evt.target.closest(".slide-actions") ||
        evt.target.closest("details")
      )
        return;
      switchSlide(el.dataset.sectionId);
    });
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", el.dataset.sectionId);
      e.dataTransfer.effectAllowed = "move";
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));
    el.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      el.classList.add("drag-over");
    });
    el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
    el.addEventListener("drop", async (e) => {
      e.preventDefault();
      el.classList.remove("drag-over");
      const fromId = e.dataTransfer.getData("text/plain");
      const toId = el.dataset.sectionId;
      if (fromId && fromId !== toId) await reorderTo(fromId, toId);
    });
  });
  // Action dropdown
  list.querySelectorAll(".slide-action-duplicate").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const sectionId = btn.dataset.sectionId;
      // Close dropdown first so it doesn't linger over the new slide.
      btn.closest("details")?.removeAttribute("open");
      await duplicateSlide(sectionId);
    });
  });
  list.querySelectorAll(".slide-action-delete").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const sectionId = btn.dataset.sectionId;
      const s = slides.find((x) => x.section_id === sectionId);
      if (!s) return;
      if (!confirm(`Delete slide '${s.title || sectionId}'?`)) return;
      // Snapshot for rollback.
      const prevSlides = slides.slice();
      const prevNotes = new Map(notes);
      const prevCurrentSectionId = currentSectionId;
      try {
        await slideRepo.deleteSlide(deckId, sectionId);
        // Local splice — no refetch.
        const idx = slides.findIndex((x) => x.section_id === sectionId);
        slides.splice(idx, 1);
        notes.delete(sectionId);
        if (currentSectionId === sectionId) {
          // Pick adjacent slide: prefer same index (next), fall back to previous.
          currentSectionId = slides[idx]?.section_id ?? slides[idx - 1]?.section_id ?? null;
        }
        renderSlideList();
        renderProps();
        loadNotesForCurrent();
        toast("Deleted", "ok");
      } catch (err) {
        // Rollback local state.
        slides = prevSlides;
        notes = prevNotes;
        currentSectionId = prevCurrentSectionId;
        renderSlideList();
        renderProps();
        toast("Delete failed: " + err.message, "err");
      }
      // Close dropdown
      btn.closest("details")?.removeAttribute("open");
    });
  });
  $("add-slide").addEventListener("click", addSlide);
}

function renderProps() {
  const s = slides.find((x) => x.section_id === currentSectionId);
  if (!s) {
    if ($("prop-title")) $("prop-title").value = "";
    if ($("prop-section-id")) $("prop-section-id").textContent = "—";
    if ($("prop-order")) $("prop-order").textContent = "—";
    return;
  }
  if ($("prop-title")) $("prop-title").value = s.title || "";
  if ($("prop-section-id")) $("prop-section-id").textContent = s.section_id;
  if ($("prop-order")) $("prop-order").textContent = s.order;
  // Slide actions now in slide list
}

function showSlide(sectionId) {
  if (!sectionId) {
    $("canvas").src = "about:blank";
    return;
  }
  const q = editMode ? "&edit=1" : "";
  $("canvas").src =
    `./edit-frame.html?deck=${encodeURIComponent(deckId)}` +
    `&section=${encodeURIComponent(sectionId)}${q}`;
}

// Unified slide-selection path. Flushes pending notes + html buffers so
// nothing gets lost when moving away. Branches on htmlMode to populate
// the right surface (iframe vs textarea).
async function switchSlide(sid) {
  if (sid === currentSectionId) return;
  await flushNotesSave();
  await flushHtmlSave();
  currentSectionId = sid;
  renderSlideList();
  renderProps();
  loadNotesForCurrent(); // reads from cache — synchronous
  if (htmlMode) {
    loadCurrentSlideHtml(); // reads from cache — synchronous
  } else {
    showSlide(currentSectionId);
  }
}

// ── mutations ──────────────────────────────────────────────────────
async function reorderTo(fromId, toId) {
  const fromIdx = slides.findIndex((s) => s.section_id === fromId);
  const toIdx = slides.findIndex((s) => s.section_id === toId);
  if (fromIdx < 0 || toIdx < 0) return;
  // Snapshot for rollback.
  const prevSlides = slides.map((s) => ({ ...s }));
  // Reorder local array.
  const [moved] = slides.splice(fromIdx, 1);
  slides.splice(toIdx, 0, moved);
  // Mirror the order field (RPC assigns order = index, 0-based).
  slides.forEach((s, i) => { s.order = i; });
  renderSlideList(); // optimistic update — no iframe reload
  try {
    const ids = slides.map((s) => s.section_id);
    await slideRepo.reorder(deckId, ids);
    toast("Reordered", "ok");
  } catch (err) {
    // Rollback local state.
    slides = prevSlides;
    renderSlideList();
    toast("Reorder failed: " + err.message, "err");
  }
}

async function addSlide() {
  const sid = `s-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const order = slides.length ? Math.max(...slides.map((s) => s.order)) + 1 : 0;
  const content =
    `<section class="slide" data-title="Untitled">` +
    `<div><h1 data-editable="true">새 슬라이드</h1>` +
    `<p data-editable="true">내용을 입력하세요.</p></div>` +
    `</section>`;
  try {
    await slideRepo.insertSlide({
      deck_id: deckId,
      section_id: sid,
      order,
      title: "Untitled",
      content,
    });
    await notesRepo.upsert(deckId, sid, "");
    // Push into local caches — no refetch.
    slides.push({ deck_id: deckId, section_id: sid, order, title: "Untitled", content });
    notes.set(sid, "");
    currentSectionId = sid;
    renderSlideList();
    renderProps();
    loadNotesForCurrent();
    showSlide(currentSectionId);
    toast("Slide added", "ok");
  } catch (err) {
    toast("Add failed: " + err.message, "err");
  }
}

// Duplicate a slide (content + notes), insert it right after the source,
// then persist the new order. Mirrors the local-mutate + POST pattern of
// addSlide / reorderTo so we don't have to refetch the whole deck.
async function duplicateSlide(sourceSid) {
  const src = slideOf(sourceSid);
  if (!src) return;
  const srcIdx = slides.findIndex((s) => s.section_id === sourceSid);
  const newSid = `s-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const newTitle = `${src.title || "Untitled"} (copy)`;
  const newContent = src.content;
  const newNotes = notes.get(sourceSid) ?? "";
  try {
    // 1. Insert at the end first so the UNIQUE (deck_id, order) constraint
    //    isn't violated by collisions in the middle of the list.
    await slideRepo.insertSlide({
      deck_id: deckId,
      section_id: newSid,
      order: slides.length,
      title: newTitle,
      content: newContent,
    });
    await notesRepo.upsert(deckId, newSid, newNotes);

    // 2. Splice into the right position locally.
    slides.splice(srcIdx + 1, 0, {
      deck_id: deckId,
      section_id: newSid,
      order: srcIdx + 1,
      title: newTitle,
      content: newContent,
    });
    notes.set(newSid, newNotes);

    // 3. Persist that order on the server (single-transaction RPC).
    await slideRepo.reorder(deckId, slides.map((s) => s.section_id));
    slides.forEach((s, i) => (s.order = i));

    currentSectionId = newSid;
    renderSlideList();
    renderProps();
    loadNotesForCurrent();
    showSlide(newSid);
    toast("Duplicated", "ok");
  } catch (err) {
    toast("Duplicate failed: " + err.message, "err");
  }
}

// ── notes (per-slide, debounced upsert) ───────────────────────────
let notesPending = null; // { sid, content }
let notesSaveTimer = 0;

function loadNotesForCurrent() {
  const ta = $("notes-textarea");
  if (!currentSectionId) {
    ta.value = "";
    ta.disabled = true;
    return;
  }
  // Read from in-memory cache — no network round-trip.
  ta.value = notes.get(currentSectionId) ?? "";
  ta.disabled = false;
}

async function flushNotesSave() {
  if (!notesPending) return;
  clearTimeout(notesSaveTimer);
  notesSaveTimer = 0;
  const { sid, content } = notesPending;
  notesPending = null;
  try {
    await notesRepo.upsert(deckId, sid, content);
    notes.set(sid, content); // keep cache current
    setStatus(`notes saved · ${new Date().toLocaleTimeString()}`, "ok");
  } catch (err) {
    setStatus("notes save failed", "err");
    toast("Notes save failed: " + err.message, "err");
  }
}

$("notes-textarea").addEventListener("input", (e) => {
  notesPending = { sid: currentSectionId, content: e.target.value };
  clearTimeout(notesSaveTimer);
  if (autoSave) {
    setStatus("notes: saving…");
    notesSaveTimer = setTimeout(flushNotesSave, 800);
  } else {
    setStatus("notes: unsaved", "warn");
  }
});

window.addEventListener("beforeunload", () => {
  if (notesPending) flushNotesSave();
});

// ── title field (debounced) ───────────────────────────────────────
let titleSaveTimer = 0;
$("prop-title").addEventListener("input", (e) => {
  clearTimeout(titleSaveTimer);
  const newTitle = e.target.value;
  titleSaveTimer = setTimeout(async () => {
    try {
      await slideRepo.updateMeta(deckId, currentSectionId, { title: newTitle });
      const s = slides.find((x) => x.section_id === currentSectionId);
      if (s) s.title = newTitle;
      renderSlideList();
      toast("Title saved", "ok");
    } catch (err) {
      toast("Title save failed: " + err.message, "err");
    }
  }, 600);
});

// ── image library ──────────────────────────────────────────────────
async function refreshImagesGrid() {
  const grid = $("images-grid");
  grid.innerHTML =
    '<div style="opacity:.5;font-size:12px;padding:1em;grid-column:1/-1">loading…</div>';
  try {
    const images = await storageRepo.listImages(deckId);
    if (images.length === 0) {
      grid.innerHTML =
        '<div style="opacity:.5;font-size:12px;padding:1em;grid-column:1/-1">No images yet — drop files or click <b>+ Upload</b>.</div>';
      return;
    }
    grid.innerHTML = images
      .map(
        (img) => `
      <div class="img-card" data-path="${escapeHtml(img.path)}" data-url="${escapeHtml(img.url)}">
        <div class="thumb"><img src="${escapeHtml(img.url)}" alt="" loading="lazy" /></div>
        <div class="actions">
          <button class="act-copy" title="Copy URL">📋</button>
          <button class="act-insert" title="Insert into current slide">↩</button>
          <button class="act-del" title="Delete">🗑</button>
        </div>
        <div class="meta">
          <span class="nm">${escapeHtml(img.name)}</span>
          <span>${img.size != null ? Math.round(img.size / 1024) + "KB" : ""}</span>
        </div>
      </div>`,
      )
      .join("");
    grid.querySelectorAll(".img-card").forEach((card) => {
      const url = card.dataset.url;
      const path = card.dataset.path;
      card.querySelector(".act-copy").onclick = async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast("URL copied", "ok");
        } catch (err) {
          toast("Copy failed: " + err.message, "err");
        }
      };
      card.querySelector(".act-insert").onclick = () => {
        $("canvas").contentWindow?.postMessage(
          {
            type: "edit:insert-image",
            url,
            alt: card.querySelector(".nm")?.textContent || "",
          },
          "*",
        );
        $("images-modal-bg").classList.remove("show");
        toast("Inserted into current slide", "ok");
      };
      card.querySelector(".act-del").onclick = async () => {
        if (
          !confirm(
            `Delete '${card.querySelector(".nm")?.textContent}'? This cannot be undone.`,
          )
        )
          return;
        try {
          await storageRepo.deleteImage(path);
          toast("Deleted", "ok");
          await refreshImagesGrid();
        } catch (err) {
          toast("Delete failed: " + err.message, "err");
        }
      };
    });
  } catch (err) {
    grid.innerHTML = `<div style="color:#ef4444;font-size:12px;padding:1em;grid-column:1/-1">${escapeHtml(err.message)}</div>`;
  }
}

async function uploadFiles(files) {
  const list = Array.from(files || []).filter((f) =>
    f.type.startsWith("image/"),
  );
  if (list.length === 0) return;
  setStatus(`uploading ${list.length} image(s)…`);
  let ok = 0,
    fail = 0;
  for (const file of list) {
    try {
      await storageRepo.uploadImage(deckId, file);
      ok++;
    } catch (err) {
      console.warn("[image upload]", file.name, err);
      fail++;
    }
  }
  if (fail === 0) {
    setStatus(`uploaded ${ok}`, "ok");
    toast(`Uploaded ${ok} image(s)`, "ok");
  } else {
    setStatus(`uploaded ${ok}, failed ${fail}`, "err");
    toast(`${fail} upload(s) failed`, "err");
  }
  await refreshImagesGrid();
}

$("images-btn").addEventListener("click", async () => {
  $("images-deck-id").textContent = deckId;
  $("images-modal-bg").classList.add("show");
  await refreshImagesGrid();
});
$("images-close").addEventListener("click", () =>
  $("images-modal-bg").classList.remove("show"),
);
$("images-modal-bg").addEventListener("click", (e) => {
  if (e.target === $("images-modal-bg"))
    $("images-modal-bg").classList.remove("show");
});
$("images-upload-btn").addEventListener("click", () =>
  $("images-upload-input").click(),
);
$("images-upload-input").addEventListener("change", (e) => {
  uploadFiles(e.target.files);
  e.target.value = ""; // allow re-uploading the same file
});

// Drag-drop into the drop zone
const dropZone = $("images-drop-zone");
if (dropZone) {
  ["dragenter", "dragover"].forEach((ev) =>
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.add("dragging");
    }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropZone.addEventListener(ev, () => dropZone.classList.remove("dragging")),
  );
  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    uploadFiles(e.dataTransfer?.files);
  });
}

// ── share modal ────────────────────────────────────────────────────
function shareUrlFor(token) {
  const base = location.href.replace(/[^/]*$/, "");
  return (
    `${base}view.html?deck=${encodeURIComponent(deckId)}` +
    `&token=${encodeURIComponent(token)}`
  );
}

async function rotateShareToken({ silent = false } = {}) {
  const t = crypto.randomUUID();
  try {
    await deckRepo.setShareToken(deckId, t);
    deck.share_token = t;
    $("share-url").value = shareUrlFor(t);
    if (!silent) toast("New share link", "ok");
    return t;
  } catch (err) {
    toast("Token generation failed: " + err.message, "err");
    throw err;
  }
}

$("share-btn").addEventListener("click", async () => {
  if (!deck.share_token) {
    if (!confirm("No share link yet. Generate one?")) return;
    try {
      await rotateShareToken({ silent: true });
    } catch {
      return;
    }
  } else {
    $("share-url").value = shareUrlFor(deck.share_token);
  }
  $("share-modal-bg").classList.add("show");
});

$("share-copy").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText($("share-url").value);
    toast("Copied", "ok");
  } catch (err) {
    toast("Copy failed: " + err.message, "err");
  }
});

$("share-rotate").addEventListener("click", async () => {
  if (!confirm("Rotate token? Existing share links will stop working.")) return;
  try {
    await rotateShareToken();
  } catch {
    /* toast already shown */
  }
});

$("share-revoke").addEventListener("click", async () => {
  if (!confirm("Revoke sharing entirely? View links will return 'invalid'."))
    return;
  try {
    await deckRepo.setShareToken(deckId, null);
    deck.share_token = null;
    $("share-modal-bg").classList.remove("show");
    toast("Share link revoked", "ok");
  } catch (err) {
    toast("Revoke failed: " + err.message, "err");
  }
});

$("share-close").addEventListener("click", () =>
  $("share-modal-bg").classList.remove("show"),
);
$("share-modal-bg").addEventListener("click", (e) => {
  if (e.target === $("share-modal-bg"))
    $("share-modal-bg").classList.remove("show");
});

// ── frame_html modal ───────────────────────────────────────────────
$("frame-edit").addEventListener("click", () => {
  $("frame-textarea").value = deck.frame_html;
  $("frame-modal-bg").classList.add("show");
});
$("frame-cancel").addEventListener("click", () =>
  $("frame-modal-bg").classList.remove("show"),
);
$("frame-modal-bg").addEventListener("click", (e) => {
  if (e.target === $("frame-modal-bg"))
    $("frame-modal-bg").classList.remove("show");
});
$("frame-save").addEventListener("click", async () => {
  let val = $("frame-textarea").value;
  if (!val.includes("<!-- slides -->")) {
    // Auto-insert placeholder before </main>, fallback </body>, fallback EOF.
    if (val.match(/<\/main>/i)) {
      val = val.replace(/<\/main>/i, "<!-- slides -->\n</main>");
    } else if (val.match(/<\/body>/i)) {
      val = val.replace(/<\/body>/i, "<!-- slides -->\n</body>");
    } else {
      val += "\n<!-- slides -->\n";
    }
    toast("Inserted <!-- slides --> placeholder", "ok");
  }
  try {
    await deckRepo.updateFrameHtml(deckId, val);
    deck.frame_html = val;
    $("frame-modal-bg").classList.remove("show");
    showSlide(currentSectionId); // re-render with new frame
    toast("Frame saved", "ok");
  } catch (err) {
    toast("Frame save failed: " + err.message, "err");
  }
});

// Edit mode is always on; edit-toggle removed

// ── HTML edit mode (raw <section>…</section> in textarea) with highlight.js ──
let htmlPending = null; // { sid, content }
let htmlSaveTimer = 0;

// Syntax-highlight overlay: removed. The transparent-text + absolute-overlay
// trick was fragile (positioning broke against canvas-wrap, transparent text
// hid content when overlay misaligned) and left the textarea apparently
// unusable. Plain textarea with the monospace CSS in edit.html is enough.
// These no-ops keep the existing call sites harmless.
function ensureHtmlHighlightOverlay() { return null; }
function updateHtmlHighlight() { /* no-op */ }

function loadCurrentSlideHtml() {
  const ta = $("html-editor");
  if (!currentSectionId) {
    ta.value = "";
    updateHtmlHighlight();
    return;
  }
  // Read from local slides cache — no network round-trip.
  const slide = slideOf(currentSectionId);
  ta.value = slide?.content ?? "";
  htmlPending = null;
  updateHtmlHighlight();
}

async function flushHtmlSave() {
  if (!htmlPending) return;
  clearTimeout(htmlSaveTimer);
  htmlSaveTimer = 0;
  const { sid, content } = htmlPending;
  htmlPending = null;
  if (!/<section\b/i.test(content) || !/<\/section\s*>/i.test(content)) {
    setStatus("HTML missing <section>", "err");
    toast("HTML must contain a single <section>…</section> block.", "err");
    // Re-queue so the buffer isn't lost
    htmlPending = { sid, content };
    return;
  }
  try {
    await slideRepo.updateContent(deckId, sid, content);
    // Update local cache in-place — no refetch.
    const s = slideOf(sid);
    if (s) {
      s.content = content;
      // Sync title from data-title attribute if present in new content.
      const m = content.match(/data-title="([^"]*)"/i);
      if (m) s.title = m[1];
    }
    setStatus("HTML saved · " + new Date().toLocaleTimeString(), "ok");
    renderSlideList();
    renderProps();
  } catch (err) {
    setStatus("HTML save failed", "err");
    toast("HTML save failed: " + err.message, "err");
  }
}

$("html-editor").addEventListener("input", (e) => {
  if (!currentSectionId) return;
  htmlPending = { sid: currentSectionId, content: e.target.value };
  clearTimeout(htmlSaveTimer);
  if (autoSave) {
    setStatus("HTML: saving…");
    htmlSaveTimer = setTimeout(flushHtmlSave, 800);
  } else {
    setStatus("HTML: unsaved", "warn");
  }
  updateHtmlHighlight();
});

// Manual "Save now" — flushes every pending buffer (notes, HTML, and the
// iframe's inline editor) regardless of the auto-save toggle. Used both as
// the explicit save button and as the implicit safety on switchSlide /
// beforeunload.
async function flushAllPending() {
  // Tell the iframe to commit any debounced inline-editor save first; it
  // will post `edit:save` back here, which routes through the existing
  // IPC handler. Then flush our own buffers.
  $("canvas")?.contentWindow?.postMessage({ type: "edit:flush" }, "*");
  await flushHtmlSave();
  await flushNotesSave();
}

// Wire the Save-now button + the Auto-save toggle. Both targets live in the
// toolbar of edit.html.
document.addEventListener("DOMContentLoaded", () => {
  const saveBtn = $("save-html-btn"); // id kept; button text now reads "Save now"
  if (saveBtn) {
    saveBtn.addEventListener("click", async () => {
      try {
        await flushAllPending();
        setStatus("saved · " + new Date().toLocaleTimeString(), "ok");
        toast("Saved", "ok");
      } catch (err) {
        setStatus("save failed", "err");
        toast("Save failed: " + err.message, "err");
      }
    });
  }

  const toggle = $("autosave-toggle");
  if (toggle) {
    toggle.checked = autoSave;
    toggle.addEventListener("change", () => {
      autoSave = !!toggle.checked;
      try { localStorage.setItem("slidesEditor.autoSave", autoSave ? "true" : "false"); } catch {}
      setStatus(autoSave ? "auto-save: ON" : "auto-save: OFF");
      // Propagate to the iframe inline editor so it stops/starts its own debounce.
      $("canvas")?.contentWindow?.postMessage(
        { type: "edit:set-autosave", value: autoSave },
        "*",
      );
    });
  }
});

// Initial highlight overlay setup
document.addEventListener("DOMContentLoaded", () => {
  if ($("html-editor")) updateHtmlHighlight();
});

async function setHtmlMode(on) {
  // Deprecated: html-toggle is removed. Mode switching is now handled by mode-select only.
  // This function is no longer used.
  return;
}

window.addEventListener("beforeunload", () => {
  if (htmlPending) flushHtmlSave();
});

// ── keyboard shortcuts ─────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (
    e.target?.tagName === "INPUT" ||
    e.target?.tagName === "TEXTAREA" ||
    e.target?.getAttribute?.("contenteditable") === "true"
  )
    return;
  if (e.key === "h" || e.key === "H") {
    e.preventDefault();
    $("history-toggle")?.click();
  } else if (e.key === "i" || e.key === "I") {
    e.preventDefault();
    $("images-btn")?.click();
  } else if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    $("save-version")?.click();
  }
  // `?` help is bound globally via bindShortcutsHelp above.
});

// ── history drawer ─────────────────────────────────────────────────
const historyUI = new HistoryUI({
  deckId,
  panelEl: $("history-panel"),
  currentSectionGetter: () => currentSectionId,
  onRestored: async ({ section_id, source }) => {
    toast("Restored", "ok");
    if (section_id === currentSectionId) {
      // Current slide: reload notes textarea from cache (history-ui already
      // wrote to DB; cache may be stale for notes, so refetch just this one).
      if (source === "notes") {
        try {
          const n = await notesRepo.getOne(deckId, section_id);
          notes.set(section_id, n?.content ?? "");
        } catch { /* best-effort */ }
      } else {
        // Slide content restored: patch local cache.
        try {
          const fresh = await slideRepo.getOne(deckId, section_id);
          const s = slideOf(section_id);
          if (s) { s.content = fresh.content; s.title = fresh.title; }
          renderSlideList();
          renderProps();
        } catch { /* best-effort */ }
      }
      loadNotesForCurrent();
      showSlide(currentSectionId);
    } else {
      // Non-current slide: targeted fetch of that one slide + note, patch caches.
      try {
        const [fresh, freshNote] = await Promise.all([
          slideRepo.getOne(deckId, section_id),
          notesRepo.getOne(deckId, section_id),
        ]);
        const s = slideOf(section_id);
        if (s) { s.content = fresh.content; s.title = fresh.title; }
        notes.set(section_id, freshNote?.content ?? "");
        renderSlideList(); // title may have changed
      } catch (err) {
        toast("Restore patch failed: " + err.message, "err");
      }
    }
  },
});

$("history-toggle").addEventListener("click", () => {
  const open = $("hist-drawer").classList.toggle("open");
  $("history-toggle").classList.toggle("active", open);
  if (open) historyUI.refresh();
});

// ── export dropdown ───────────────────────────────────────────────
document.querySelectorAll("[data-export]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    const kind = btn.dataset.export;
    const drop = btn.closest("details");
    try {
      if (kind === "html") {
        const r = await exportHtml(deckId);
        toast(`Saved ${r.filename}`, "ok");
      } else if (kind === "pdf") {
        exportPdf(deckId);
        toast("Print window opened", "ok");
      } else if (kind === "md") {
        const r = await exportNotesMd(deckId);
        toast(`Saved ${r.filename}`, "ok");
      } else if (kind === "md-copy") {
        await exportNotesMd(deckId, { copy: true });
        toast("Copied notes to clipboard", "ok");
      }
    } catch (err) {
      toast("Export failed: " + err.message, "err");
    } finally {
      if (drop) drop.open = false;
    }
  });
});
// Close the dropdown when clicking elsewhere.
document.addEventListener("click", (e) => {
  const drop = $("export-dropdown");
  if (drop && drop.open && !drop.contains(e.target)) drop.open = false;
});

$("save-version").addEventListener("click", async () => {
  try {
    const ts = await saveVersionPrompt(deckId);
    if (ts === null) return;
    toast("Version saved", "ok");
    if ($("hist-drawer").classList.contains("open")) historyUI.refresh();
  } catch (err) {
    toast("Save version failed: " + err.message, "err");
  }
});

// ── iframe IPC ─────────────────────────────────────────────────────
window.addEventListener("message", async (e) => {
  const m = e.data;
  if (!m || typeof m.type !== "string") return;
  if (!m.type.startsWith("edit:") && !m.type.startsWith("edit-frame:")) return;

  switch (m.type) {
    case "edit:dirty":
      setStatus("saving…");
      break;
    case "edit:save": {
      try {
        await slideRepo.updateContent(m.deck_id, m.section_id, m.content);
        // Update local cache in-place so subsequent renders show new content.
        const _s = slideOf(m.section_id);
        if (_s) _s.content = m.content;
        setStatus("saved · " + new Date().toLocaleTimeString(), "ok");
      } catch (err) {
        setStatus("save failed", "err");
        toast("Save failed: " + err.message, "err");
      }
      break;
    }
    case "edit:noop":
      setStatus("no changes");
      break;
    case "edit:ready":
      setStatus(
        `ready · ${m.editable_count} editable${m.editable_count === 1 ? "" : "s"}`,
      );
      // Hand the current auto-save state to the fresh inline editor so it
      // doesn't run its 800ms debounce when the user has turned it off.
      e.source?.postMessage(
        { type: "edit:set-autosave", value: autoSave },
        "*",
      );
      break;
    case "edit-frame:error":
      setStatus("frame error", "err");
      toast("Frame: " + m.message, "err");
      break;
    case "edit-frame:request-data": {
      // Serve cached deck + slide so the iframe doesn't refetch on every
      // navigation. If our caches aren't populated yet (initial load), stay
      // silent — the iframe will time out and fall back to a direct fetch.
      if (!deck) break;
      const _s = slideOf(m.sectionId);
      if (!_s) break;
      e.source?.postMessage(
        { type: "edit-frame:data", id: m.id, deck, slide: _s },
        "*",
      );
      break;
    }
  }
});

// ── mode select (16:9 vs raw-html) ─────────────────────────────────
// Switches the canvas between iframe (16:9) and a raw <section> textarea.
// Flushes pending HTML before switching out of html mode so nothing is lost.
function initModeSelect() {
  const sel = $("mode-select");
  const wrap = $("canvas-wrap");
  if (!sel || !wrap) return;

  async function apply() {
    const m = sel.value;
    // Pending HTML edits should land before we leave html mode.
    if (htmlMode && m !== "html") await flushHtmlSave();
    wrap.classList.remove("aspect-169", "html-mode");
    if (m === "html") {
      wrap.classList.add("html-mode");
      htmlMode = true;
      loadCurrentSlideHtml(); // reads from cache — synchronous
      // Focus after the next paint so display:block has actually taken effect.
      requestAnimationFrame(() => $("html-editor")?.focus());
    } else if (m === "aspect-169") {
      wrap.classList.add("aspect-169");
      htmlMode = false;
      if (currentSectionId) showSlide(currentSectionId);
    } else {
      // "" (placeholder) or unknown → no class, iframe fills the canvas.
      htmlMode = false;
      if (currentSectionId) showSlide(currentSectionId);
    }
  }

  sel.addEventListener("change", apply);
  apply(); // honor the <option selected> default ("aspect-169")
}

// ── init ───────────────────────────────────────────────────────────
await refresh();
initModeSelect();
