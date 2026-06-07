// Defensive: Removed legacy delete-slide button logic (no such element in DOM)
// Mode-select handler is initialized below `refresh()` (see initModeSelect),
// so currentSectionId / htmlMode / show- and load- helpers are all in scope
// and the iframe canvas is already populated by the time mode applies.
// Main controller for edit.html.
// Owns: passphrase gate, slide list (incl. DnD reorder), iframe canvas
// switching, props panel, add/delete, frame_html modal, IPC with iframe.
import { ensureAuthed } from "./auth.js";
import { exportHtml, exportNotesMd, exportPdf, exportPptx } from "./export.js";
import { HistoryUI, saveVersionPrompt } from "./history-ui.js";
import * as deckRepo from "./repo/deck-repo.js";
import * as notesRepo from "./repo/notes-repo.js";
import * as slideRepo from "./repo/slide-repo.js";
import * as storageRepo from "./repo/storage-repo.js";
import { bindShortcutsHelp } from "./shortcuts-help.js";
import {
  isSlideHiddenContent,
  setSlideHiddenContent,
} from "./slide-visibility.js";

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
let htmlCodeMirror = null;
let suppressHtmlEditorSync = false;
let htmlHighlightSyncBound = false;
let titlePending = null; // { sid, title }
let titleSaveTimer = 0;
const NOTES_FONT_SIZE_KEY = "slidesEditor.notesFontSize";
const NOTES_FONT_SIZE_MIN = 11;
const NOTES_FONT_SIZE_MAX = 20;
const NOTES_FONT_SIZE_STEP = 1;
const LAST_SECTION_KEY_PREFIX = "slidesEditor.lastSectionId:";
const SLIDE_LIST_WIDTH_KEY = "slidesEditor.slideListWidth";
const SLIDE_LIST_WIDTH_MIN = 180;
const SLIDE_LIST_WIDTH_MAX = 520;
const PROPS_PANEL_WIDTH_KEY = "slidesEditor.propsPanelWidth";
const PROPS_PANEL_HEIGHT_KEY = "slidesEditor.propsPanelHeight";
const PROPS_PANEL_WIDTH_MIN = 220;
const PROPS_PANEL_WIDTH_MAX = 720;
const PROPS_PANEL_HEIGHT_MIN = 180;
const PROPS_PANEL_HEIGHT_MAX = 520;
// Auto-save toggle. Persisted in localStorage so it survives reloads.
// When OFF, debounced timers are NOT scheduled in any input handler — edits
// stay buffered in *Pending and are only flushed by the manual Save button
// or by `flushAllPending()` (e.g., on slide switch / beforeunload).
let autoSave = localStorage.getItem("slidesEditor.autoSave") !== "false";

// Tiny helper: find a slide object by section_id.
function slideOf(sid) {
  return slides.find((s) => s.section_id === sid) || null;
}

function lastSectionKey() {
  return `${LAST_SECTION_KEY_PREFIX}${deckId}`;
}

function saveLastSectionId(sectionId) {
  if (!sectionId) return;
  try {
    localStorage.setItem(lastSectionKey(), sectionId);
  } catch {}
}

function restoreLastSectionId() {
  const saved = localStorage.getItem(lastSectionKey());
  return saved && slides.some((slide) => slide.section_id === saved)
    ? saved
    : null;
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
function hiddenSlideIcon() {
  return `
    <svg aria-hidden="true" class="svg-icon" style="width: 1em; height: 1em; vertical-align: middle; fill: currentColor; color: var(--text-mid); overflow: hidden; flex: 0 0 auto;" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
      <path d="M900.266667 379.733333c-12.8-8.533333-34.133333-8.533333-42.666667 8.533334-136.533333 187.733333-396.8 226.133333-584.533333 93.866666-42.666667-29.866667-76.8-64-102.4-106.666666-8.533333-12.8-29.866667-17.066667-42.666667-8.533334-12.8 8.533333-17.066667 29.866667-8.533333 42.666667 29.866667 46.933333 72.533333 85.333333 115.2 119.466667 17.066667 12.8 38.4 25.6 55.466666 34.133333l-81.066666 81.066667c-12.8 12.8-12.8 34.133333 0 46.933333 4.266667 4.266667 12.8 8.533333 21.333333 8.533333s17.066667-4.266667 21.333333-8.533333L345.6 597.333333l4.266667-4.266666c42.666667 17.066667 85.333333 25.6 128 29.866666v119.466667c0 17.066667 12.8 34.133333 34.133333 34.133333s34.133333-12.8 34.133333-34.133333v-123.733333c38.4-4.266667 72.533333-8.533333 110.933334-17.066667 0 0 0 4.266667 4.266666 4.266667l93.866667 93.866666c4.266667 4.266667 12.8 8.533333 21.333333 8.533334s17.066667-4.266667 21.333334-8.533334c12.8-12.8 12.8-34.133333 0-46.933333l-76.8-76.8c72.533333-34.133333 136.533333-85.333333 187.733333-153.6 8.533333-12.8 4.266667-29.866667-8.533333-42.666667z" fill="currentColor" />
    </svg>`;
}
function setStatus(text, kind = "") {
  const el = $("status");
  el.textContent = text;
  el.dataset.kind = kind;
}

function getNotesFontSize() {
  const parsed = Number.parseInt(
    localStorage.getItem(NOTES_FONT_SIZE_KEY) || "",
    10,
  );
  if (Number.isFinite(parsed)) {
    return Math.min(NOTES_FONT_SIZE_MAX, Math.max(NOTES_FONT_SIZE_MIN, parsed));
  }
  return 14;
}

function setNotesFontSize(size) {
  const nextSize = Math.min(
    NOTES_FONT_SIZE_MAX,
    Math.max(NOTES_FONT_SIZE_MIN, size),
  );
  document.documentElement.style.setProperty(
    "--notes-font-size",
    `${nextSize}px`,
  );
  try {
    localStorage.setItem(NOTES_FONT_SIZE_KEY, String(nextSize));
  } catch {}
  return nextSize;
}

setNotesFontSize(getNotesFontSize());

function getStoredPx(key, fallback) {
  const raw = localStorage.getItem(key);
  const parsed = Number.parseInt(raw || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function setStoredPx(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {}
}

function getCssPx(varName, fallback) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(
    varName,
  );
  const parsed = Number.parseInt(raw || "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function applySlideListWidth(px, max = SLIDE_LIST_WIDTH_MAX) {
  const next = Math.min(max, Math.max(SLIDE_LIST_WIDTH_MIN, px));
  document.documentElement.style.setProperty("--slide-list-width", `${next}px`);
  setStoredPx(SLIDE_LIST_WIDTH_KEY, next);
  return next;
}

function syncSlideTitleInputs(title) {
  for (const id of ["prop-title", "slide-list-title"]) {
    const el = $(id);
    if (el && el.value !== title) el.value = title;
  }
}

function renderSlideListInfo(slide) {
  const info = $("slide-list-info");
  const count = $("slide-list-count");
  if (count) {
    count.textContent = `${slides.length} slide${slides.length === 1 ? "" : "s"}`;
  }
  if (!info) return;
  info.innerHTML = "";
}

function updateNavLinks() {
  const presentLink = $("present-link");
  const presentUrl = new URL("./present.html", location.href);
  presentUrl.searchParams.set("deck", deckId);
  if (currentSectionId) {
    presentUrl.searchParams.set("section", currentSectionId);
  }
  presentLink.href = presentUrl.toString();
}

function queueTitleSave(title) {
  if (!currentSectionId) return;
  titlePending = { sid: currentSectionId, title };
  clearTimeout(titleSaveTimer);
  setStatus("title: saving…");
  titleSaveTimer = setTimeout(flushTitleSave, 600);
}

async function flushTitleSave() {
  if (!titlePending) return;
  clearTimeout(titleSaveTimer);
  titleSaveTimer = 0;
  const { sid, title } = titlePending;
  titlePending = null;
  try {
    await slideRepo.updateMeta(deckId, sid, { title });
    const slide = slideOf(sid);
    if (slide) slide.title = title;
    syncSlideTitleInputs(title);
    renderSlideList();
    renderProps();
    setStatus("title saved", "ok");
  } catch (err) {
    toast("Title save failed: " + err.message, "err");
    setStatus("title save failed", "err");
  }
}

function applyPropsPanelWidth(px, max = PROPS_PANEL_WIDTH_MAX) {
  const next = Math.min(max, Math.max(PROPS_PANEL_WIDTH_MIN, px));
  document.documentElement.style.setProperty("--props-width", `${next}px`);
  setStoredPx(PROPS_PANEL_WIDTH_KEY, next);
  return next;
}

function applyPropsPanelHeight(px, max = PROPS_PANEL_HEIGHT_MAX) {
  const next = Math.min(max, Math.max(PROPS_PANEL_HEIGHT_MIN, px));
  document.documentElement.style.setProperty("--props-height", `${next}px`);
  const body = $("body");
  if (body?.classList.contains("portrait-mode")) {
    body.style.gridTemplateRows = `minmax(0, 1fr) ${next}px`;
  }
  setStoredPx(PROPS_PANEL_HEIGHT_KEY, next);
  return next;
}

applySlideListWidth(getStoredPx(SLIDE_LIST_WIDTH_KEY, 240));
applyPropsPanelWidth(getStoredPx(PROPS_PANEL_WIDTH_KEY, 280));
applyPropsPanelHeight(getStoredPx(PROPS_PANEL_HEIGHT_KEY, 280));

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
  updateNavLinks();
  if ($("script-link")) {
    $("script-link").href = `./script.html?deck=${encodeURIComponent(deckId)}`;
  }
  if ($("notes-fullscreen-link")) {
    $("notes-fullscreen-link").href =
      `./script-edit.html?deck=${encodeURIComponent(deckId)}`;
  }
  $("export-notes-link").href =
    `./notes.html?deck=${encodeURIComponent(deckId)}`;
  document.title = `Edit · ${deck.title || deckId}`;

  if (
    !currentSectionId ||
    !slides.find((s) => s.section_id === currentSectionId)
  ) {
    currentSectionId = restoreLastSectionId() || slides[0]?.section_id || null;
  }
  saveLastSectionId(currentSectionId);
  renderSlideList();
  renderProps();
  loadNotesForCurrent(); // now reads from cache — synchronous, no await needed
  if (!keepIframe) showSlide(currentSectionId);
}

function renderSlideList() {
  const list = $("slide-list");
  const items = $("slide-list-items") || list;
  const currentSlide = slideOf(currentSectionId);
  syncSlideTitleInputs(currentSlide?.title || "");
  renderSlideListInfo(currentSlide);
  items.innerHTML =
    slides
      .map(
        (s, i) => `
    <div class="slide-item ${s.section_id === currentSectionId ? "active" : ""}"
          draggable="true" data-section-id="${escapeHtml(s.section_id)}" data-hidden="${isSlideHiddenContent(s.content) ? "true" : "false"}">
      <span class="order">${i + 1}</span>
      <span class="title">${isSlideHiddenContent(s.content) ? `<span class="hidden-slide-icon" title="Hidden in presentation">${hiddenSlideIcon()}</span> ` : ""}${escapeHtml(s.title || s.section_id)}</span>
      <span class="slide-actions">
        <details class="dropdown slide-dropdown" style="display:inline-block;">
          <summary class="btn" style="padding:0 8px;min-width:32px;text-align:center;">…</summary>
          <div class="dropdown-menu" style="min-width:80px;right:0;left:auto;">
            <button class="slide-action-toggle-hidden" data-section-id="${escapeHtml(s.section_id)}">${isSlideHiddenContent(s.content) ? "Show" : "Hide"}</button>
            <button class="slide-action-duplicate" data-section-id="${escapeHtml(s.section_id)}">Duplicate</button>
            <button class="slide-action-delete" data-section-id="${escapeHtml(s.section_id)}">Delete</button>
          </div>
        </details>
      </span>
    </div>`,
      )
      .join("") + '<button id="add-slide">+ New slide</button>';

  items.querySelectorAll(".slide-item").forEach((el) => {
    // Only switch slide if not clicking on an action button (edit/delete)
    el.addEventListener("click", (evt) => {
      if (
        evt.target.closest(".slide-action-toggle-hidden") ||
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
  items.querySelectorAll(".slide-action-toggle-hidden").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const sectionId = btn.dataset.sectionId;
      const s = slides.find((x) => x.section_id === sectionId);
      if (!s) return;
      btn.closest("details")?.removeAttribute("open");
      await setSlideHiddenState(sectionId, !isSlideHiddenContent(s.content));
    });
  });
  items.querySelectorAll(".slide-action-duplicate").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const sectionId = btn.dataset.sectionId;
      // Close dropdown first so it doesn't linger over the new slide.
      btn.closest("details")?.removeAttribute("open");
      await duplicateSlide(sectionId);
    });
  });
  items.querySelectorAll(".slide-action-delete").forEach((btn) => {
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
          currentSectionId =
            slides[idx]?.section_id ?? slides[idx - 1]?.section_id ?? null;
          saveLastSectionId(currentSectionId);
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
  $("add-slide")?.addEventListener("click", addSlide);
}

function renderProps() {
  const s = slides.find((x) => x.section_id === currentSectionId);
  if (!s) {
    if ($("prop-title")) $("prop-title").value = "";
    if ($("prop-section-id")) $("prop-section-id").textContent = "—";
    if ($("prop-order")) $("prop-order").textContent = "—";
    if ($("prop-hidden")) $("prop-hidden").checked = false;
    return;
  }
  if ($("prop-title")) $("prop-title").value = s.title || "";
  if ($("prop-section-id")) $("prop-section-id").textContent = s.section_id;
  if ($("prop-order")) $("prop-order").textContent = s.order;
  if ($("prop-hidden"))
    $("prop-hidden").checked = isSlideHiddenContent(s.content);
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
  await flushTitleSave();
  await flushNotesSave();
  await flushHtmlSave();
  currentSectionId = sid;
  saveLastSectionId(currentSectionId);
  renderSlideList();
  renderProps();
  loadNotesForCurrent(); // reads from cache — synchronous
  if (htmlMode) {
    loadCurrentSlideHtml(); // reads from cache — synchronous
  } else {
    showSlide(currentSectionId);
  }
  updateNavLinks();
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
  slides.forEach((s, i) => {
    s.order = i;
  });
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
    slides.push({
      deck_id: deckId,
      section_id: sid,
      order,
      title: "Untitled",
      content,
    });
    notes.set(sid, "");
    currentSectionId = sid;
    saveLastSectionId(currentSectionId);
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
  const nextOrder = slides.length
    ? Math.max(...slides.map((s) => s.order ?? 0)) + 1
    : 0;
  try {
    // 1. Insert at a fresh tail order so the UNIQUE (deck_id, order)
    //    constraint isn't violated by gaps from prior deletes/reorders.
    await slideRepo.insertSlide({
      deck_id: deckId,
      section_id: newSid,
      order: nextOrder,
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
    await slideRepo.reorder(
      deckId,
      slides.map((s) => s.section_id),
    );
    slides.forEach((s, i) => (s.order = i));

    currentSectionId = newSid;
    saveLastSectionId(currentSectionId);
    renderSlideList();
    renderProps();
    loadNotesForCurrent();
    showSlide(newSid);
    toast("Duplicated", "ok");
  } catch (err) {
    toast("Duplicate failed: " + err.message, "err");
  }
}

async function setSlideHiddenState(sectionId, hidden) {
  const slide = slideOf(sectionId);
  if (!slide) return;
  const prevContent = slide.content;
  const nextContent = setSlideHiddenContent(prevContent, hidden);
  if (nextContent === prevContent) return;
  try {
    slide.content = nextContent;
    await slideRepo.updateContent(deckId, sectionId, nextContent);
    renderSlideList();
    renderProps();
    if (htmlMode) loadCurrentSlideHtml();
    else showSlide(currentSectionId);
    toast(
      hidden ? "Slide hidden in presentation" : "Slide shown in presentation",
      "ok",
    );
  } catch (err) {
    slide.content = prevContent;
    renderProps();
    toast("Visibility update failed: " + err.message, "err");
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

function adjustNotesFontSize(delta) {
  const current = getNotesFontSize();
  setNotesFontSize(current + delta * NOTES_FONT_SIZE_STEP);
}

$("notes-size-down")?.addEventListener("click", () => adjustNotesFontSize(-1));
$("notes-size-up")?.addEventListener("click", () => adjustNotesFontSize(1));

window.addEventListener("beforeunload", () => {
  if (titlePending) flushTitleSave();
  if (notesPending) flushNotesSave();
});

// ── title field (debounced) ───────────────────────────────────────
// Slide title inputs are optional in the DOM. If absent, skip binding.
for (const id of ["prop-title", "slide-list-title"]) {
  const el = $(id);
  if (!el) continue;
  el.addEventListener("input", (e) => {
    queueTitleSave(e.target.value);
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      flushTitleSave();
      el.blur();
    }
  });
  el.addEventListener("blur", () => flushTitleSave());
}

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

// ── SVG Shape Picker ──────────────────────────────────────────────
const SVG_SHAPES = [
  {
    id: "rect",
    label: "Rectangle",
    render: (f, s, sw) =>
      `<rect x="8" y="18" width="84" height="64" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`,
  },
  {
    id: "rect-r",
    label: "Rounded",
    render: (f, s, sw) =>
      `<rect x="8" y="18" width="84" height="64" rx="14" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`,
  },
  {
    id: "circle",
    label: "Circle",
    render: (f, s, sw) =>
      `<circle cx="50" cy="50" r="40" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`,
  },
  {
    id: "ellipse",
    label: "Ellipse",
    render: (f, s, sw) =>
      `<ellipse cx="50" cy="50" rx="45" ry="28" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`,
  },
  {
    id: "triangle",
    label: "Triangle",
    render: (f, s, sw) =>
      `<polygon points="50,6 94,90 6,90" fill="${f}" stroke="${s}" stroke-width="${sw}" stroke-linejoin="round"/>`,
  },
  {
    id: "diamond",
    label: "Diamond",
    render: (f, s, sw) =>
      `<polygon points="50,4 96,50 50,96 4,50" fill="${f}" stroke="${s}" stroke-width="${sw}" stroke-linejoin="round"/>`,
  },
  {
    id: "star",
    label: "Star",
    render: (f, s, sw) => {
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 44 : 18;
        const a = (Math.PI / 5) * i - Math.PI / 2;
        pts.push(
          `${(50 + r * Math.cos(a)).toFixed(2)},${(50 + r * Math.sin(a)).toFixed(2)}`,
        );
      }
      return `<polygon points="${pts.join(" ")}" fill="${f}" stroke="${s}" stroke-width="${sw}" stroke-linejoin="round"/>`;
    },
  },
  {
    id: "arrow-r",
    label: "Arrow \u2192",
    render: (f, s, sw) =>
      `<polygon points="5,33 62,33 62,12 95,50 62,88 62,67 5,67" fill="${f}" stroke="${s}" stroke-width="${sw}" stroke-linejoin="round"/>`,
  },
  {
    id: "arrow-l",
    label: "Arrow \u2190",
    render: (f, s, sw) =>
      `<polygon points="95,33 38,33 38,12 5,50 38,88 38,67 95,67" fill="${f}" stroke="${s}" stroke-width="${sw}" stroke-linejoin="round"/>`,
  },
  {
    id: "arrow-u",
    label: "Arrow \u2191",
    render: (f, s, sw) =>
      `<polygon points="33,95 33,38 12,38 50,5 88,38 67,38 67,95" fill="${f}" stroke="${s}" stroke-width="${sw}" stroke-linejoin="round"/>`,
  },
  {
    id: "line-h",
    label: "Line \u2014",
    render: (f, s, sw) =>
      `<line x1="5" y1="50" x2="95" y2="50" stroke="${sw > 0 ? s : f}" stroke-width="${Math.max(sw, 4)}" stroke-linecap="round"/>`,
  },
  {
    id: "check",
    label: "Checkmark",
    render: (f, s, sw) =>
      `<polyline points="8,52 36,78 92,20" fill="none" stroke="${f}" stroke-width="${Math.max(sw, 8)}" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  {
    id: "cross",
    label: "Cross \u2715",
    render: (f, s, sw) =>
      `<line x1="14" y1="14" x2="86" y2="86" stroke="${f}" stroke-width="${Math.max(sw, 8)}" stroke-linecap="round"/><line x1="86" y1="14" x2="14" y2="86" stroke="${f}" stroke-width="${Math.max(sw, 8)}" stroke-linecap="round"/>`,
  },
  {
    id: "plus",
    label: "Plus +",
    render: (f, s, sw) =>
      `<line x1="50" y1="10" x2="50" y2="90" stroke="${f}" stroke-width="${Math.max(sw, 8)}" stroke-linecap="round"/><line x1="10" y1="50" x2="90" y2="50" stroke="${f}" stroke-width="${Math.max(sw, 8)}" stroke-linecap="round"/>`,
  },
  {
    id: "speech",
    label: "Speech",
    render: (f, s, sw) =>
      `<path d="M8,8 H92 A6,6 0 0,1 98,14 V60 A6,6 0 0,1 92,66 H42 L28,90 28,66 H8 A6,6 0 0,1 2,60 V14 A6,6 0 0,1 8,8 Z" fill="${f}" stroke="${s}" stroke-width="${sw}" stroke-linejoin="round"/>`,
  },
  {
    id: "heart",
    label: "Heart",
    render: (f, s, sw) =>
      `<path d="M50,82 C50,82 8,54 8,28 A22,22 0 0,1 50,18 A22,22 0 0,1 92,28 C92,54 50,82 50,82 Z" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`,
  },
];

const SVG_SOURCE_SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="8" y="8" width="84" height="84" rx="18" fill="#5db8a6"/>
  <path d="M28 54 L43 69 L72 34" fill="none" stroke="#ffffff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

function ensureSvgSourceSample() {
  const ta = $("svg-custom-code");
  if (!ta) return;
  if (!ta.value.trim()) ta.value = SVG_SOURCE_SAMPLE;
}

function parseSvgSource(raw) {
  const text = raw.trim();
  if (!text) return { ok: false, message: "SVG 코드를 입력해주세요." };
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  if (doc.querySelector("parsererror")) {
    return { ok: false, message: "SVG 문법이 올바르지 않습니다." };
  }
  const svg = doc.documentElement;
  if (!svg || svg.tagName.toLowerCase() !== "svg") {
    return { ok: false, message: "루트 엘리먼트는 <svg> 여야 합니다." };
  }
  return { ok: true, svg };
}

function updateSvgSourcePreview() {
  const ta = $("svg-custom-code");
  const preview = $("svg-custom-preview");
  const status = $("svg-custom-status");
  if (!ta || !preview || !status) return;
  const result = parseSvgSource(ta.value);
  if (!result.ok) {
    preview.innerHTML = "";
    status.textContent = result.message;
    status.dataset.kind = "err";
    return;
  }
  preview.innerHTML = result.svg.outerHTML;
  status.textContent = `OK · ${result.svg.getAttribute("viewBox") || "no viewBox"}`;
  status.dataset.kind = "ok";
}

function insertCustomSvg() {
  const raw = $("svg-custom-code")?.value || "";
  const result = parseSvgSource(raw);
  if (!result.ok) {
    toast(result.message, "err");
    updateSvgSourcePreview();
    return;
  }
  const wrapped = `<span contenteditable="false" style="display:inline-block;line-height:0;vertical-align:middle;">${result.svg.outerHTML}</span>`;
  $("canvas")?.contentWindow?.postMessage(
    { type: "edit:insert-svg", html: wrapped },
    "*",
  );
  $("svg-modal-bg").classList.remove("show");
  toast("SVG inserted", "ok");
}

function buildShapeSvgHtml(renderFn) {
  const fill = $("svg-fill").value;
  const stroke = $("svg-stroke").value;
  const sw = Number($("svg-stroke-w").value) || 0;
  const size = Math.max(20, Number($("svg-size").value) || 120);
  const inner = renderFn(fill, stroke, sw);
  return `<span contenteditable="false" style="display:inline-block;line-height:0;vertical-align:middle;"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}">${inner}</svg></span>`;
}

function renderSvgShapeGrid() {
  const grid = $("svg-shape-grid");
  if (!grid) return;
  const fill = $("svg-fill").value;
  const stroke = $("svg-stroke").value;
  const sw = Number($("svg-stroke-w").value) || 0;
  grid.innerHTML = SVG_SHAPES.map(
    (shape) =>
      `<button class="svg-shape-btn" data-shape="${shape.id}" type="button">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="58" height="58">
          ${shape.render(fill, stroke, sw)}
        </svg>
        <span>${shape.label}</span>
      </button>`,
  ).join("");
  grid.querySelectorAll(".svg-shape-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const shape = SVG_SHAPES.find((s) => s.id === btn.dataset.shape);
      if (!shape) return;
      const html = buildShapeSvgHtml(shape.render);
      $("canvas")?.contentWindow?.postMessage(
        { type: "edit:insert-svg", html },
        "*",
      );
      $("svg-modal-bg").classList.remove("show");
      toast("SVG inserted", "ok");
    });
  });
}

$("svg-btn").addEventListener("click", () => {
  $("svg-modal-bg").classList.add("show");
  ensureSvgSourceSample();
  renderSvgShapeGrid();
  updateSvgSourcePreview();
});
$("svg-close").addEventListener("click", () =>
  $("svg-modal-bg").classList.remove("show"),
);
$("svg-modal-bg").addEventListener("click", (e) => {
  if (e.target === $("svg-modal-bg"))
    $("svg-modal-bg").classList.remove("show");
});

// Re-render preview when color/stroke controls change
["svg-fill", "svg-stroke", "svg-stroke-w"].forEach((id) => {
  $(id)?.addEventListener("input", renderSvgShapeGrid);
});

// Tab switching
document.querySelectorAll(".svg-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document
      .querySelectorAll(".svg-tab")
      .forEach((t) => t.classList.toggle("active", t === tab));
    $("svg-tab-shapes").style.display =
      tab.dataset.tab === "shapes" ? "" : "none";
    $("svg-tab-custom").style.display =
      tab.dataset.tab === "custom" ? "" : "none";
    if (tab.dataset.tab === "custom") {
      ensureSvgSourceSample();
      updateSvgSourcePreview();
      $("svg-custom-code")?.focus();
    }
  });
});

$("svg-custom-code")?.addEventListener("input", updateSvgSourcePreview);

// Custom SVG insert
$("svg-custom-insert").addEventListener("click", insertCustomSvg);

$("images-btn").addEventListener("click", async () => {
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
const FRAME_PART_INFO = {
  html: {
    label: "HTML",
    help: "문서 구조, head, body, layout을 편집합니다.",
  },
  css: {
    label: "CSS",
    help: "frame_html 안의 <style> 블록 전체를 편집합니다.",
  },
  js: {
    label: "JS",
    help: "frame_html 안의 inline <script> 블록 전체를 편집합니다.",
  },
};

let frameDraft = null;
let frameActivePart = "html";

function createEmptyFrameDraft() {
  return { html: "", css: "", js: "", jsType: "" };
}

function parseFrameDraft(frameHtml) {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(
    frameHtml || "<!doctype html><html><head></head><body></body></html>",
    "text/html",
  );
  const styleNodes = Array.from(parsed.querySelectorAll("style"));
  const scriptNodes = Array.from(parsed.querySelectorAll("script:not([src])"));
  const css = styleNodes
    .map((node) => node.textContent ?? "")
    .filter(Boolean)
    .join("\n\n");
  const js = scriptNodes
    .map((node) => node.textContent ?? "")
    .filter(Boolean)
    .join("\n\n");
  const jsType = scriptNodes.some((node) => node.type === "module")
    ? "module"
    : "";

  styleNodes.forEach((node) => node.remove());
  scriptNodes.forEach((node) => node.remove());

  return {
    html: `<!doctype html>\n${parsed.documentElement.outerHTML}`,
    css,
    js,
    jsType,
  };
}

function serializeFrameDraft(draft) {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(
    draft?.html || "<!doctype html><html><head></head><body></body></html>",
    "text/html",
  );

  parsed.querySelectorAll("style").forEach((node) => node.remove());
  parsed.querySelectorAll("script:not([src])").forEach((node) => node.remove());

  const css = (draft?.css ?? "").trimEnd();
  if (css) {
    const style = parsed.createElement("style");
    style.textContent = css;
    parsed.head?.appendChild(style);
  }

  const js = (draft?.js ?? "").trimEnd();
  if (js) {
    const script = parsed.createElement("script");
    if (draft?.jsType === "module") {
      script.type = "module";
    }
    script.textContent = js;
    parsed.body?.appendChild(script);
  }

  let html = `<!doctype html>\n${parsed.documentElement.outerHTML}`;
  const hadPlaceholder = html.includes("<!-- slides -->");
  if (!hadPlaceholder) {
    if (html.match(/<\/main>/i)) {
      html = html.replace(/<\/main>/i, "<!-- slides -->\n</main>");
    } else if (html.match(/<\/body>/i)) {
      html = html.replace(/<\/body>/i, "<!-- slides -->\n</body>");
    } else {
      html += "\n<!-- slides -->\n";
    }
  }
  return { html, insertedPlaceholder: !hadPlaceholder };
}

function getFrameEditorValue() {
  return $("frame-textarea")?.value ?? "";
}

function setFrameEditorValue(value) {
  const editor = $("frame-textarea");
  if (editor && editor.value !== value) editor.value = value;
}

function syncFramePartButtons() {
  document.querySelectorAll("[data-frame-part]").forEach((btn) => {
    const part = btn.dataset.framePart;
    btn.classList.toggle("active", part === frameActivePart);
  });
  const info = FRAME_PART_INFO[frameActivePart] || FRAME_PART_INFO.html;
  const label = $("frame-editor-label");
  const help = $("frame-editor-help");
  if (label) label.textContent = info.label;
  if (help) help.textContent = info.help;
}

function setFrameEditorPart(part) {
  if (!FRAME_PART_INFO[part]) return;
  if (!frameDraft) frameDraft = createEmptyFrameDraft();
  frameDraft[frameActivePart] = getFrameEditorValue();
  frameActivePart = part;
  setFrameEditorValue(frameDraft[part] || "");
  syncFramePartButtons();
}

function openFrameModal() {
  frameDraft = parseFrameDraft(deck.frame_html);
  frameActivePart = "html";
  setFrameEditorValue(frameDraft.html);
  syncFramePartButtons();
  $("frame-modal-bg").classList.add("show");
}

$("frame-edit").addEventListener("click", () => {
  openFrameModal();
});
$("frame-sidebar")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-frame-part]");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  setFrameEditorPart(btn.dataset.framePart);
  $("frame-textarea").focus();
});
$("frame-cancel").addEventListener("click", () =>
  $("frame-modal-bg").classList.remove("show"),
);
$("frame-modal-bg").addEventListener("click", (e) => {
  if (e.target === $("frame-modal-bg"))
    $("frame-modal-bg").classList.remove("show");
});
$("frame-textarea").addEventListener("input", () => {
  if (!frameDraft) frameDraft = createEmptyFrameDraft();
  frameDraft[frameActivePart] = getFrameEditorValue();
});
$("frame-save").addEventListener("click", async () => {
  if (!frameDraft) frameDraft = parseFrameDraft(deck.frame_html);
  frameDraft[frameActivePart] = getFrameEditorValue();

  const { html: val, insertedPlaceholder } = serializeFrameDraft(frameDraft);
  if (insertedPlaceholder) {
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

function ensureHtmlHighlightOverlay() {
  return {
    ta: $("html-editor"),
    hl: $("html-highlight"),
  };
}

function getHtmlEditorValue() {
  if (htmlCodeMirror) return htmlCodeMirror.getValue();
  return $("html-editor")?.value ?? "";
}

function setHtmlEditorValue(value) {
  if (htmlCodeMirror) {
    suppressHtmlEditorSync = true;
    htmlCodeMirror.setValue(value);
    htmlCodeMirror.refresh();
    suppressHtmlEditorSync = false;
    return;
  }
  const ta = $("html-editor");
  if (ta) ta.value = value;
}

function queueHtmlChange(content) {
  if (!currentSectionId) return;
  htmlPending = { sid: currentSectionId, content };
  clearTimeout(htmlSaveTimer);
  if (autoSave) {
    setStatus("HTML: saving…");
    htmlSaveTimer = setTimeout(flushHtmlSave, 800);
  } else {
    setStatus("HTML: unsaved", "warn");
  }
  updateHtmlHighlight();
}

function ensureHtmlCodeMirror() {
  if (htmlCodeMirror || !window.CodeMirror) return htmlCodeMirror;
  const ta = $("html-editor");
  if (!ta) return null;
  htmlCodeMirror = window.CodeMirror.fromTextArea(ta, {
    mode: "xml",
    theme: "monokai",
    lineNumbers: true,
    lineWrapping: true,
    tabSize: 2,
    indentUnit: 2,
    indentWithTabs: false,
    viewportMargin: Infinity,
    extraKeys: {
      "Cmd-Shift-F": () => formatCurrentHtml(),
      "Ctrl-Shift-F": () => formatCurrentHtml(),
    },
  });
  htmlCodeMirror.setSize("100%", "100%");
  htmlCodeMirror.on("change", () => {
    if (suppressHtmlEditorSync) return;
    queueHtmlChange(htmlCodeMirror.getValue());
  });
  htmlCodeMirror.on("scroll", () => {
    // CodeMirror owns its own scroll position.
  });
  return htmlCodeMirror;
}
function updateHtmlHighlight() {
  if (htmlCodeMirror) return;
  const { ta, hl } = ensureHtmlHighlightOverlay();
  if (!ta || !hl) return;
  const value = ta.value || "";
  if (!value.trim()) {
    hl.textContent = value;
  } else if (window.hljs?.highlight) {
    try {
      hl.innerHTML = window.hljs.highlight(value, {
        language: "xml",
        ignoreIllegals: true,
      }).value;
    } catch {
      hl.textContent = value;
    }
  } else {
    hl.textContent = value;
  }
  hl.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
}

function loadCurrentSlideHtml() {
  if (!currentSectionId) {
    setHtmlEditorValue("");
    updateHtmlHighlight();
    return;
  }
  // Read from local slides cache — no network round-trip.
  const slide = slideOf(currentSectionId);
  setHtmlEditorValue(slide?.content ?? "");
  htmlPending = null;
  updateHtmlHighlight();
}

function bindHtmlHighlightSync() {
  if (htmlHighlightSyncBound || htmlCodeMirror) return;
  const ta = $("html-editor");
  const hl = $("html-highlight");
  if (!ta || !hl) return;
  htmlHighlightSyncBound = true;
  ta.addEventListener("scroll", () => {
    hl.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
  });
}

function formatHtmlSource(source) {
  const preservedBlocks = [];
  const protectedSource = String(source).replace(
    /<(pre|code)\b[^>]*>[\s\S]*?<\/\1>/gi,
    (match) => {
      const token = `__HTML_PRESERVE_BLOCK_${preservedBlocks.length}__`;
      preservedBlocks.push(match);
      return token;
    },
  );
  const template = document.createElement("template");
  template.innerHTML = protectedSource.trim();
  const indentUnit = "  ";
  const selfClosingTags = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);

  function escapeAttr(value) {
    return String(value).replace(/"/g, "&quot;");
  }

  function formatNode(node, depth) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.replace(/\s+/g, " ").trim();
      return text ? `${indentUnit.repeat(depth)}${text}\n` : "";
    }

    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();
    const attrs = [...node.attributes]
      .map((attr) => `${attr.name}="${escapeAttr(attr.value)}"`)
      .join(" ");
    const openTag = attrs ? `<${tag} ${attrs}>` : `<${tag}>`;
    const children = [...node.childNodes]
      .map((child) => formatNode(child, depth + 1))
      .join("");
    const textContent = node.textContent.replace(/\s+/g, " ").trim();
    const hasElementChildren = [...node.childNodes].some(
      (child) => child.nodeType === Node.ELEMENT_NODE,
    );

    if (!children && !textContent && selfClosingTags.has(tag)) {
      return `${indentUnit.repeat(depth)}<${tag}${attrs ? ` ${attrs}` : ""} />\n`;
    }

    if (!hasElementChildren && node.childNodes.length === 1) {
      return `${indentUnit.repeat(depth)}${openTag}${textContent}</${tag}>\n`;
    }

    return `${indentUnit.repeat(depth)}${openTag}\n${children}${indentUnit.repeat(depth)}</${tag}>\n`;
  }

  const formatted = [...template.content.childNodes]
    .map((node) => formatNode(node, 0))
    .join("")
    .trimEnd();

  return preservedBlocks.reduce(
    (output, block, index) =>
      output.replace(`__HTML_PRESERVE_BLOCK_${index}__`, block),
    formatted,
  );
}

function formatCurrentHtml() {
  const ta = htmlCodeMirror || $("html-editor");
  if (!ta) return;
  const current = htmlCodeMirror ? htmlCodeMirror.getValue() : ta.value;
  const formatted = formatHtmlSource(current);
  if (formatted === current) {
    toast("Already formatted", "ok");
    return;
  }
  if (htmlCodeMirror) {
    suppressHtmlEditorSync = true;
    htmlCodeMirror.setValue(formatted);
    htmlCodeMirror.refresh();
    suppressHtmlEditorSync = false;
  } else {
    ta.value = formatted;
  }
  htmlPending = { sid: currentSectionId, content: formatted };
  updateHtmlHighlight();
  if (autoSave) {
    clearTimeout(htmlSaveTimer);
    htmlSaveTimer = setTimeout(flushHtmlSave, 0);
    setStatus("HTML: formatting…");
  } else {
    setStatus("HTML formatted · unsaved", "warn");
  }
  toast("HTML formatted", "ok");
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
  if (htmlCodeMirror) return;
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
  bindHtmlHighlightSync();
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
      try {
        localStorage.setItem(
          "slidesEditor.autoSave",
          autoSave ? "true" : "false",
        );
      } catch {}
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
  bindHtmlHighlightSync();
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
  const htmlEditorFocused =
    htmlMode && document.activeElement?.id === "html-editor";
  if (
    htmlEditorFocused &&
    (e.ctrlKey || e.metaKey) &&
    e.shiftKey &&
    (e.key === "f" || e.key === "F")
  ) {
    e.preventDefault();
    formatCurrentHtml();
    return;
  }
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
    if (source === "frame") {
      try {
        const freshDeck = await deckRepo.getDeck(deckId);
        deck.frame_html = freshDeck.frame_html;
        if (currentSectionId) showSlide(currentSectionId);
      } catch {
        /* best-effort */
      }
      return;
    }
    if (section_id === currentSectionId) {
      // Current slide: reload notes textarea from cache (history-ui already
      // wrote to DB; cache may be stale for notes, so refetch just this one).
      if (source === "notes") {
        try {
          const n = await notesRepo.getOne(deckId, section_id);
          notes.set(section_id, n?.content ?? "");
        } catch {
          /* best-effort */
        }
      } else {
        // Slide content restored: patch local cache.
        try {
          const fresh = await slideRepo.getOne(deckId, section_id);
          const s = slideOf(section_id);
          if (s) {
            s.content = fresh.content;
            s.title = fresh.title;
          }
          renderSlideList();
          renderProps();
        } catch {
          /* best-effort */
        }
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
        if (s) {
          s.content = fresh.content;
          s.title = fresh.title;
        }
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
      } else if (kind === "pptx") {
        toast("PPTX 생성 중…", "ok");
        const r = await exportPptx(deckId);
        toast(`Saved ${r.filename}`, "ok");
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

// ── mode select (16:9 / 9:16 / raw-html) ───────────────────────────
// Switches the workspace between canvas presets and raw <section> textarea.
// Flushes pending HTML before switching out of html mode so nothing is lost.
function initModeSelect() {
  const sel = $("mode-select");
  const body = $("body");
  const wrap = $("canvas-wrap");
  if (!sel || !wrap || !body) return;

  async function apply() {
    const m = sel.value;
    // Pending HTML edits should land before we leave html mode.
    if (htmlMode && m !== "html") await flushHtmlSave();
    body.classList.remove("portrait-mode");
    wrap.classList.remove("aspect-169", "portrait-169", "html-mode");
    if (m === "html") {
      wrap.classList.add("html-mode");
      htmlMode = true;
      ensureHtmlCodeMirror();
      loadCurrentSlideHtml(); // reads from cache — synchronous
      formatCurrentHtml();
      // Focus after the next paint so display:block has actually taken effect.
      requestAnimationFrame(() => {
        if (htmlCodeMirror) htmlCodeMirror.focus();
        else $("html-editor")?.focus();
      });
    } else if (m === "portrait") {
      body.classList.add("portrait-mode");
      wrap.classList.add("portrait-169");
      body.style.gridTemplateRows = `minmax(0, 1fr) ${getStoredPx(
        PROPS_PANEL_HEIGHT_KEY,
        280,
      )}px`;
      htmlMode = false;
      if (currentSectionId) showSlide(currentSectionId);
    } else if (m === "aspect-169") {
      wrap.classList.add("aspect-169");
      body.style.gridTemplateRows = "";
      htmlMode = false;
      if (currentSectionId) showSlide(currentSectionId);
    } else if (m === "default") {
      body.style.gridTemplateRows = "";
      htmlMode = false;
      if (currentSectionId) showSlide(currentSectionId);
    } else {
      // "" (placeholder) or unknown → no class, iframe fills the canvas.
      body.style.gridTemplateRows = "";
      htmlMode = false;
      if (currentSectionId) showSlide(currentSectionId);
    }
  }

  sel.addEventListener("change", apply);
  apply(); // honor the <option selected> default ("default")
}

function initPropsResizer() {
  const handle = $("props-resizer");
  const props = $("props");
  const body = $("body");
  if (!handle || !props || !body) return;

  let dragging = false;
  let onMove = null;
  let onUp = null;

  function finishDrag() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (onMove) document.removeEventListener("pointermove", onMove);
    if (onUp) document.removeEventListener("pointerup", onUp);
    onMove = null;
    onUp = null;
  }

  function updateFromPointer(clientX, clientY) {
    if (body.classList.contains("portrait-mode")) {
      const bodyRect = body.getBoundingClientRect();
      const max = Math.max(
        PROPS_PANEL_HEIGHT_MIN,
        window.innerHeight - 48 - 180,
      );
      const next = bodyRect.bottom - clientY;
      applyPropsPanelHeight(next, max);
    } else {
      const max = Math.max(
        PROPS_PANEL_WIDTH_MIN,
        window.innerWidth - 240 - 240,
      );
      const next = window.innerWidth - clientX;
      applyPropsPanelWidth(next, max);
    }
  }

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dragging = true;
    handle.classList.add("dragging");
    document.body.style.cursor = body.classList.contains("portrait-mode")
      ? "row-resize"
      : "col-resize";
    document.body.style.userSelect = "none";
    handle.setPointerCapture?.(e.pointerId);
    onMove = (moveEvent) => {
      if (!dragging) return;
      updateFromPointer(moveEvent.clientX, moveEvent.clientY);
    };
    onUp = () => finishDrag();
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp, { once: true });
  });

  handle.addEventListener("pointerup", finishDrag);
  handle.addEventListener("pointercancel", finishDrag);
  handle.addEventListener("lostpointercapture", finishDrag);
  window.addEventListener("blur", finishDrag);
}

function initSlideListResizer() {
  const handle = $("slide-list-resizer");
  const list = $("slide-list");
  const body = $("body");
  if (!handle || !list || !body) return;

  let dragging = false;
  let onMove = null;
  let onUp = null;

  function finishDrag() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (onMove) document.removeEventListener("pointermove", onMove);
    if (onUp) document.removeEventListener("pointerup", onUp);
    onMove = null;
    onUp = null;
  }

  function updateFromPointer(clientX) {
    const bodyRect = body.getBoundingClientRect();
    const propsWidth = getCssPx(
      "--props-width",
      getStoredPx(PROPS_PANEL_WIDTH_KEY, 280),
    );
    const landscapeMax = Math.max(
      SLIDE_LIST_WIDTH_MIN,
      window.innerWidth - propsWidth - 240,
    );
    const portraitMax = Math.max(SLIDE_LIST_WIDTH_MIN, window.innerWidth - 240);
    const max = body.classList.contains("portrait-mode")
      ? portraitMax
      : landscapeMax;
    const next = clientX - bodyRect.left;
    applySlideListWidth(next, max);
  }

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dragging = true;
    handle.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    handle.setPointerCapture?.(e.pointerId);
    onMove = (moveEvent) => {
      if (!dragging) return;
      updateFromPointer(moveEvent.clientX);
    };
    onUp = () => finishDrag();
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp, { once: true });
  });

  handle.addEventListener("pointerup", finishDrag);
  handle.addEventListener("pointercancel", finishDrag);
  handle.addEventListener("lostpointercapture", finishDrag);
  window.addEventListener("blur", finishDrag);
}

// ── init ───────────────────────────────────────────────────────────
await refresh();
initModeSelect();
initSlideListResizer();
initPropsResizer();
