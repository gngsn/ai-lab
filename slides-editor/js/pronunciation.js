/**
 * pronunciation.js — English pronunciation training
 * Layout: sections list | script text | training panel
 *
 * The training panel (TTS / record / scoring) lives in the shared
 * ./training-panel.js module. This file owns deck loading, the section
 * list, the script pane, the resizers, and the full-deck audio export.
 */

import { ensureAuthed } from "./auth.js";
import { buildNotesMd } from "./export.js";
import {
  cleanForSpeech,
  createTrainingPanel,
  mergeBlobs,
  silenceWav,
} from "./training-panel.js";

// ── Auth ──────────────────────────────────────────────────────────
if (!ensureAuthed()) {
  document.body.innerHTML =
    '<p style="color:#ef4444;padding:2rem;font-family:monospace">Access denied.</p>';
  throw new Error("auth");
}

const params = new URLSearchParams(location.search);
const deckId = params.get("deck");
if (!deckId) {
  document.body.innerHTML =
    '<p style="color:#ef4444;padding:2rem;font-family:monospace">Missing ?deck=</p>';
  throw new Error("no deck");
}

// ── State ─────────────────────────────────────────────────────────
let currentSpeed = 1.0;
let currentIndex = 0;
let slides = [];
let notesMap = new Map();
let panel = null; // shared training-panel instance

const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ── Section list ──────────────────────────────────────────────────
function renderSectionList() {
  sectionListEl.innerHTML = "";
  slides.forEach((s, i) => {
    const item = document.createElement("div");
    item.className = "sec-item" + (i === currentIndex ? " active" : "");
    item.dataset.i = i;
    item.innerHTML = `
      <span class="num">${i + 1}</span>
      <span class="label">${escapeHtml(s.title || `Slide ${i + 1}`)}</span>
      <span class="sec-score" id="sec-score-${i}"></span>`;
    item.addEventListener("click", () => selectSection(i));
    sectionListEl.appendChild(item);
  });
}

function updateSectionActive() {
  sectionListEl
    .querySelectorAll(".sec-item")
    .forEach((el, i) => el.classList.toggle("active", i === currentIndex));
}

// Update the section-list badge for a scored take.
function onScore(sectionId, score, cls) {
  const index = slides.findIndex((s) => s.section_id === sectionId);
  if (index < 0) return;
  const badge = $(`sec-score-${index}`);
  if (badge) {
    badge.textContent = score + "%";
    badge.className = `sec-score show ${cls}`;
  }
}

// ── Script pane ───────────────────────────────────────────────────
function selectSection(index) {
  currentIndex = index;
  updateSectionActive();

  const slide = slides[index];
  const rawNotes = notesMap.get(slide.section_id) || "";
  const cleanText = cleanForSpeech(rawNotes);

  scriptTitleEl.textContent = slide.title || `Slide ${index + 1}`;
  scriptNumEl.textContent = `#${index + 1} / ${slides.length}`;

  // Load slide iframe
  if (slideIframeEl) {
    const iframeSrc = `./edit-frame.html?deck=${encodeURIComponent(deckId)}&section=${encodeURIComponent(slide.section_id)}`;
    if (slideIframeEl.src !== iframeSrc) {
      slideIframeEl.src = iframeSrc;
    }
  }

  if (cleanText) {
    scriptBodyEl.textContent = cleanText;
    scriptBodyEl.classList.remove("empty");
  } else {
    scriptBodyEl.textContent = "(no notes for this slide)";
    scriptBodyEl.classList.add("empty");
  }

  // Hand the current section to the training panel (resets feedback,
  // restores latest take + recording, re-binds scoring).
  panel.setSection({
    sectionId: slide.section_id,
    title: slide.title || `Slide ${index + 1}`,
    text: rawNotes,
  });
}

// ── Export ────────────────────────────────────────────────────────
async function onExport() {
  const exportBtn = $("export-btn");
  const progress = $("export-progress");
  const bar = $("export-progress-bar");
  const status = $("export-status");

  exportBtn.disabled = true;
  progress.style.display = "block";
  const sil = silenceWav(1.5);
  const blobs = [];

  for (let i = 0; i < slides.length; i++) {
    const slide = slides[i];
    const cleanText = cleanForSpeech(notesMap.get(slide.section_id) || "");
    if (!cleanText) continue;
    status.textContent = `${i + 1}/${slides.length}…`;
    bar.style.width = `${Math.round((i / slides.length) * 100)}%`;
    try {
      const { buf, mime } = await panel.synthesize(
        slide.section_id,
        slide.title || `Slide ${i + 1}`,
        notesMap.get(slide.section_id) || "",
      );
      blobs.push(new Blob([buf], { type: mime || "audio/mpeg" }));
      if (i < slides.length - 1) blobs.push(sil);
    } catch (err) {
      status.textContent = `Error: ${err.message}`;
      exportBtn.disabled = false;
      progress.style.display = "none";
      return;
    }
    bar.style.width = `${Math.round(((i + 1) / slides.length) * 100)}%`;
  }

  status.textContent = "Merging…";
  try {
    const merged = await mergeBlobs(blobs);
    const url = URL.createObjectURL(merged);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${deckId}-${currentSpeed}x.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    status.textContent = "✓ Done";
  } catch (err) {
    status.textContent = "Merge error: " + err.message;
  }
  exportBtn.disabled = false;
  progress.style.display = "none";
}

// ── DOM refs (populated after init) ──────────────────────────────
let sectionListEl,
  scriptBodyEl,
  scriptTitleEl,
  scriptNumEl,
  slideIframeEl;

// ── Build DOM ─────────────────────────────────────────────────────
function buildDOM() {
  const grid = $("main-grid");
  grid.innerHTML = `
    <aside id="section-list">
      <div id="sec-resizer" class="col-resizer" aria-hidden="true"></div>
    </aside>
    <section id="script-pane">
      <div id="script-heading">
        <span class="slide-title" id="script-title">—</span>
        <span class="slide-num"  id="script-num">—</span>
      </div>
      <div id="slide-preview-wrap">
        <div id="slide-stage">
          <iframe id="slide-iframe" title="Slide preview" sandbox="allow-scripts allow-same-origin"></iframe>
        </div>
      </div>
      <div id="script-body" class="empty">(select a section)</div>
    </section>
    <section id="training-panel">
      <div id="trn-resizer" class="col-resizer" aria-hidden="true"></div>
      <div id="training-mount"></div>
    </section>`;

  // Cache DOM refs
  sectionListEl = $("section-list");
  scriptBodyEl = $("script-body");
  scriptTitleEl = $("script-title");
  scriptNumEl = $("script-num");
  slideIframeEl = $("slide-iframe");

  // Mount the shared training panel.
  panel = createTrainingPanel($("training-mount"), {
    deckId,
    getSection: () => {
      const slide = slides[currentIndex];
      if (!slide) return { sectionId: null, title: "", text: "" };
      return {
        sectionId: slide.section_id,
        title: slide.title || `Slide ${currentIndex + 1}`,
        text: notesMap.get(slide.section_id) || "",
      };
    },
    onScore,
  });

  $("export-btn").onclick = onExport;

  // Speed slider
  $("speed-slider").addEventListener("input", (e) => {
    currentSpeed = parseFloat(e.target.value);
    $("speed-label").textContent =
      currentSpeed.toFixed(2).replace(/\.?0+$/, "") + "×";
    panel.setSpeed(currentSpeed);
  });
  // TTS engine selector
  const ttsSelect = $("tts-engine");
  if (ttsSelect) {
    ttsSelect.value = panel.getEngine();
    ttsSelect.addEventListener("change", () => {
      panel.setEngine(ttsSelect.value);
    });
  }
}

// ── Panel resizers ─────────────────────────────────────────────────────
const SEC_MIN = 120,
  SEC_MAX = 400;
const TRN_MIN = 240,
  TRN_MAX = 560;

function setCssVar(name, px) {
  document.documentElement.style.setProperty(name, px + "px");
}

function makeColResizer(handleId, { getWidth, setWidth, minW, maxW }) {
  const handle = $(handleId);
  if (!handle) return;
  let dragging = false,
    onMove = null,
    onUp = null;

  function finish() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove("dragging");
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (onMove) document.removeEventListener("pointermove", onMove);
    if (onUp) document.removeEventListener("pointerup", onUp);
    onMove = onUp = null;
  }

  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dragging = true;
    handle.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    handle.setPointerCapture?.(e.pointerId);
    onMove = (ev) => {
      if (dragging)
        setWidth(Math.min(maxW, Math.max(minW, getWidth(ev.clientX))));
    };
    onUp = () => finish();
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp, { once: true });
  });
  handle.addEventListener("pointerup", finish);
  handle.addEventListener("pointercancel", finish);
  handle.addEventListener("lostpointercapture", finish);
  window.addEventListener("blur", finish);
}

function initResizers() {
  // Left resizer: drags right edge of #section-list
  makeColResizer("sec-resizer", {
    getWidth: (clientX) => clientX, // left pane width = cursor X from viewport left
    setWidth: (w) => setCssVar("--sec-list-width", w),
    minW: SEC_MIN,
    maxW: SEC_MAX,
  });
  // Right resizer: drags left edge of #training-panel
  makeColResizer("trn-resizer", {
    getWidth: (clientX) => window.innerWidth - clientX,
    setWidth: (w) => setCssVar("--training-width", w),
    minW: TRN_MIN,
    maxW: TRN_MAX,
  });
}

// ── Init ──────────────────────────────────────────────────────────
async function init() {
  $("notes-link").href = `./notes.html?deck=${encodeURIComponent(deckId)}`;

  let deck;
  try {
    const result = await buildNotesMd(deckId);
    deck = result.deck;
    slides = result.slides;
    notesMap = new Map(result.notes.map((n) => [n.section_id, n.content]));
  } catch (err) {
    $("main-grid").innerHTML =
      `<p style="color:#ef4444;padding:2rem;font-family:monospace">${escapeHtml(err.message)}</p>`;
    return;
  }

  $("deck-title").textContent = deck.title || deckId;
  document.title = `Pronunciation · ${deck.title || deckId}`;

  buildDOM();
  initResizers();
  renderSectionList();
  selectSection(0);
}

init().catch(console.error);
