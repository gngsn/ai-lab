// Main controller for edit.html.
// Owns: passphrase gate, slide list (incl. DnD reorder), iframe canvas
// switching, props panel, add/delete, frame_html modal, IPC with iframe.
import * as deckRepo from "./repo/deck-repo.js";
import * as slideRepo from "./repo/slide-repo.js";
import * as notesRepo from "./repo/notes-repo.js";
import * as storageRepo from "./repo/storage-repo.js";
import { ensureAuthed } from "./auth.js";
import { HistoryUI, saveVersionPrompt } from "./history-ui.js";
import { exportHtml, exportPdf, exportNotesMd } from "./export.js";
import { bindShortcutsHelp } from "./shortcuts-help.js";

bindShortcutsHelp("Edit", [
  { keys: ["E"], desc: "Toggle edit mode (canvas)" },
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

// ── mobile redirect (slides editing is desktop-only per SPEC §4) ───
const mobileQ = window.matchMedia(
  "(max-width: 900px), (max-width: 1024px) and (orientation: landscape)",
);
const params = new URLSearchParams(location.search);
const deckId = params.get("deck");
if (!deckId) {
  document.body.innerHTML =
    '<p style="padding:2rem;color:#ef4444">Missing ?deck=&lt;deck_id&gt;</p>';
  throw new Error("no deck");
}
if (mobileQ.matches) {
  location.replace(`./script.html?deck=${encodeURIComponent(deckId)}`);
  throw new Error("mobile redirect");
}

// ── state ──────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
let deck = null;
let slides = [];
let currentSectionId = null;
let editMode = true;

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
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
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
    [deck, slides] = await Promise.all([
      deckRepo.getDeck(deckId),
      slideRepo.listByDeck(deckId),
    ]);
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
  $("export-notes-link").href = `./notes.html?deck=${encodeURIComponent(deckId)}`;
  document.title = `Edit · ${deck.title || deckId}`;

  if (!currentSectionId || !slides.find((s) => s.section_id === currentSectionId)) {
    currentSectionId = slides[0]?.section_id || null;
  }
  renderSlideList();
  renderProps();
  await loadNotesForCurrent();
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
    </div>`,
      )
      .join("") + '<button id="add-slide">+ New slide</button>';

  list.querySelectorAll(".slide-item").forEach((el) => {
    el.addEventListener("click", async () => {
      const sid = el.dataset.sectionId;
      if (sid === currentSectionId) return;
      await flushNotesSave(); // never lose in-progress note edits
      currentSectionId = sid;
      renderSlideList();
      renderProps();
      await loadNotesForCurrent();
      showSlide(currentSectionId);
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
  $("add-slide").addEventListener("click", addSlide);
}

function renderProps() {
  const s = slides.find((x) => x.section_id === currentSectionId);
  if (!s) {
    $("prop-title").value = "";
    $("prop-section-id").textContent = "—";
    $("prop-order").textContent = "—";
    $("delete-slide").disabled = true;
    return;
  }
  $("prop-title").value = s.title || "";
  $("prop-section-id").textContent = s.section_id;
  $("prop-order").textContent = s.order;
  $("delete-slide").disabled = false;
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

// ── mutations ──────────────────────────────────────────────────────
async function reorderTo(fromId, toId) {
  const ids = slides.map((s) => s.section_id);
  const fromIdx = ids.indexOf(fromId);
  const toIdx = ids.indexOf(toId);
  if (fromIdx < 0 || toIdx < 0) return;
  ids.splice(toIdx, 0, ids.splice(fromIdx, 1)[0]);
  try {
    await slideRepo.reorder(deckId, ids);
    toast("Reordered", "ok");
    await refresh({ keepIframe: true });
  } catch (err) {
    toast("Reorder failed: " + err.message, "err");
  }
}

async function addSlide() {
  const sid = `s-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const order = slides.length
    ? Math.max(...slides.map((s) => s.order)) + 1
    : 0;
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
    currentSectionId = sid;
    await refresh();
    toast("Slide added", "ok");
  } catch (err) {
    toast("Add failed: " + err.message, "err");
  }
}

$("delete-slide").addEventListener("click", async () => {
  if (!currentSectionId) return;
  const s = slides.find((x) => x.section_id === currentSectionId);
  if (!confirm(`Delete slide '${s?.title || currentSectionId}'?`)) return;
  try {
    await slideRepo.deleteSlide(deckId, currentSectionId);
    currentSectionId = null;
    await refresh();
    toast("Deleted", "ok");
  } catch (err) {
    toast("Delete failed: " + err.message, "err");
  }
});

// ── notes (per-slide, debounced upsert) ───────────────────────────
let notesPending = null; // { sid, content }
let notesSaveTimer = 0;

async function loadNotesForCurrent() {
  const ta = $("notes-textarea");
  if (!currentSectionId) {
    ta.value = "";
    ta.disabled = true;
    return;
  }
  try {
    const note = await notesRepo.getOne(deckId, currentSectionId);
    ta.value = note?.content || "";
    ta.disabled = false;
  } catch (err) {
    ta.value = "";
    ta.disabled = false;
    toast("Notes load failed: " + err.message, "err");
  }
}

async function flushNotesSave() {
  if (!notesPending) return;
  clearTimeout(notesSaveTimer);
  notesSaveTimer = 0;
  const { sid, content } = notesPending;
  notesPending = null;
  try {
    await notesRepo.upsert(deckId, sid, content);
    setStatus(`notes saved · ${new Date().toLocaleTimeString()}`, "ok");
  } catch (err) {
    setStatus("notes save failed", "err");
    toast("Notes save failed: " + err.message, "err");
  }
}

$("notes-textarea").addEventListener("input", (e) => {
  notesPending = { sid: currentSectionId, content: e.target.value };
  setStatus("notes: saving…");
  clearTimeout(notesSaveTimer);
  notesSaveTimer = setTimeout(flushNotesSave, 800);
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
          { type: "edit:insert-image", url, alt: card.querySelector(".nm")?.textContent || "" },
          "*",
        );
        $("images-modal-bg").classList.remove("show");
        toast("Inserted into current slide", "ok");
      };
      card.querySelector(".act-del").onclick = async () => {
        if (!confirm(`Delete '${card.querySelector(".nm")?.textContent}'? This cannot be undone.`)) return;
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
  const list = Array.from(files || []).filter((f) => f.type.startsWith("image/"));
  if (list.length === 0) return;
  setStatus(`uploading ${list.length} image(s)…`);
  let ok = 0, fail = 0;
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
  if (e.target === $("images-modal-bg")) $("images-modal-bg").classList.remove("show");
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
  if (!confirm("Revoke sharing entirely? View links will return 'invalid'.")) return;
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
  if (e.target === $("share-modal-bg")) $("share-modal-bg").classList.remove("show");
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
  if (e.target === $("frame-modal-bg")) $("frame-modal-bg").classList.remove("show");
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

// ── edit on/off toggle (re-mounts iframe with/without ?edit=1) ────
$("edit-toggle").addEventListener("click", () => {
  editMode = !editMode;
  $("edit-toggle").classList.toggle("active", editMode);
  $("edit-toggle").textContent = editMode ? "Edit · on (E)" : "Edit · off (E)";
  showSlide(currentSectionId);
});
$("edit-toggle").classList.add("active");

// ── keyboard shortcuts ─────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (
    e.target?.tagName === "INPUT" ||
    e.target?.tagName === "TEXTAREA" ||
    e.target?.getAttribute?.("contenteditable") === "true"
  )
    return;
  if (e.key === "e" || e.key === "E") {
    e.preventDefault();
    $("edit-toggle").click();
  } else if (e.key === "h" || e.key === "H") {
    e.preventDefault();
    $("history-toggle").click();
  } else if (e.key === "i" || e.key === "I") {
    e.preventDefault();
    $("images-btn").click();
  } else if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
    e.preventDefault();
    $("save-version").click();
  }
  // `?` help is bound globally via bindShortcutsHelp above.
});

// ── history drawer ─────────────────────────────────────────────────
const historyUI = new HistoryUI({
  deckId,
  panelEl: $("history-panel"),
  currentSectionGetter: () => currentSectionId,
  onRestored: async ({ section_id }) => {
    toast("Restored", "ok");
    // Refresh the slide content / iframe / notes textarea
    if (section_id === currentSectionId) {
      await loadNotesForCurrent();
      showSlide(currentSectionId);
    } else {
      await refresh();
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
    case "edit:save":
      try {
        await slideRepo.updateContent(m.deck_id, m.section_id, m.content);
        setStatus("saved · " + new Date().toLocaleTimeString(), "ok");
      } catch (err) {
        setStatus("save failed", "err");
        toast("Save failed: " + err.message, "err");
      }
      break;
    case "edit:noop":
      setStatus("no changes");
      break;
    case "edit:ready":
      setStatus(
        `ready · ${m.editable_count} editable${m.editable_count === 1 ? "" : "s"}`,
      );
      break;
    case "edit-frame:error":
      setStatus("frame error", "err");
      toast("Frame: " + m.message, "err");
      break;
  }
});

// ── init ───────────────────────────────────────────────────────────
await refresh();
