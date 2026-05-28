// Main controller for edit.html.
// Owns: passphrase gate, slide list (incl. DnD reorder), iframe canvas
// switching, props panel, add/delete, frame_html modal, IPC with iframe.
import * as deckRepo from "./repo/deck-repo.js";
import * as slideRepo from "./repo/slide-repo.js";
import * as notesRepo from "./repo/notes-repo.js";
import { ensureAuthed } from "./auth.js";

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
  document.title = `Edit · ${deck.title || deckId}`;

  if (!currentSectionId || !slides.find((s) => s.section_id === currentSectionId)) {
    currentSectionId = slides[0]?.section_id || null;
  }
  renderSlideList();
  renderProps();
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
    el.addEventListener("click", () => {
      const sid = el.dataset.sectionId;
      if (sid === currentSectionId) return;
      currentSectionId = sid;
      renderSlideList();
      renderProps();
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
  } else if (e.key === "?" || (e.shiftKey && e.key === "/")) {
    alert(
      "Keyboard:\n" +
        "  E       — toggle edit mode\n" +
        "  Click   — select slide\n" +
        "  Drag    — reorder in list\n" +
        "  ⌘+S     — (M5) Save version\n" +
        "  ?       — this help\n",
    );
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
