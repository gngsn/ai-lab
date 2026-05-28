// Teleprompter view, ported from personal-log/Kprintf2026/v5/script.html.
// Differences from v5:
//   - Data comes from slides+notes join (not a static scripts[] array)
//   - Sync payload is `{section_id, index}` — section_id is preferred so
//     re-ordered decks don't desync the viewer.
//   - Manual mode toggles via sync-badge click, like v5.
import { createSlideSync } from "./sync.js";

const FONT_KEY = "slides-editor:notes:fontsize";

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

export function mountScriptView({ deck, sections, syncId }) {
  // sections: [{ section_id, order, title, body }]
  let currentIdx = 0;
  let fontSize = parseFloat(localStorage.getItem(FONT_KEY) || "1.15");
  let manualMode = false;
  let noHighlight = false;
  let sync = null;

  const $ = (id) => document.getElementById(id);
  const indexById = new Map(sections.map((s, i) => [s.section_id, i]));

  function setManual(v) {
    manualMode = v;
    $("mode-label").textContent = v ? "· 수동" : "";
    $("sync-badge").style.opacity = v ? "0.5" : "";
  }

  function applyFontSize() {
    localStorage.setItem(FONT_KEY, String(fontSize));
    document
      .querySelectorAll(".sec-body")
      .forEach((el) => (el.style.fontSize = fontSize + "rem"));
  }

  function render() {
    const container = $("script");
    container.innerHTML = sections
      .map((s, i) => {
        const cls =
          i === currentIdx
            ? "active"
            : Math.abs(i - currentIdx) === 1
              ? "adj"
              : "";
        const bodyText = (s.body || "").trim();
        const bodyHtml = bodyText
          ? escapeHtml(bodyText).replace(/\n/g, "<br>")
          : '<span style="opacity:.4">(빈 노트)</span>';
        const label = escapeHtml(s.title || `장표 ${i + 1}`);
        return (
          `<div class="sec ${cls}" data-idx="${i}" data-section-id="${escapeHtml(s.section_id)}">` +
          `<div class="sec-label">${label}</div>` +
          `<div class="sec-body" style="font-size:${fontSize}rem">${bodyHtml}</div>` +
          `</div>`
        );
      })
      .join("");

    document
      .querySelector(".sec.active")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });

    const pct =
      sections.length > 1 ? (currentIdx / (sections.length - 1)) * 100 : 100;
    $("progress").style.width = pct + "%";
    $("slide-counter").textContent = `${currentIdx + 1} / ${sections.length}`;
  }

  // Subscribe to broadcast (only if syncId is provided)
  if (syncId) {
    $("sync-badge").classList.add("live");
    $("sync-label").textContent = syncId;
    sync = createSlideSync(syncId, (payload) => {
      if (manualMode) return;
      const fromId =
        payload?.section_id && indexById.has(payload.section_id)
          ? indexById.get(payload.section_id)
          : null;
      const i = fromId ?? payload?.index ?? null;
      if (i != null && i !== currentIdx && i >= 0 && i < sections.length) {
        currentIdx = i;
        render();
      }
    });
  }

  // Wire events
  $("sync-badge").onclick = () => setManual(!manualMode);
  $("increaseFont").onclick = () => {
    fontSize = Math.min(fontSize + 0.1, 2.5);
    applyFontSize();
  };
  $("decreaseFont").onclick = () => {
    fontSize = Math.max(fontSize - 0.1, 0.7);
    applyFontSize();
  };
  $("prevSlide").onclick = () => {
    setManual(true);
    if (currentIdx > 0) currentIdx--;
    render();
  };
  $("nextSlide").onclick = () => {
    setManual(true);
    if (currentIdx < sections.length - 1) currentIdx++;
    render();
  };
  $("toggleHL").onclick = () => {
    noHighlight = !noHighlight;
    $("script").classList.toggle("no-hl", noHighlight);
    $("toggleHL").classList.toggle("btn-on", noHighlight);
  };
  $("script").addEventListener("click", (e) => {
    const sec = e.target.closest(".sec");
    if (!sec) return;
    const idx = parseInt(sec.dataset.idx, 10);
    if (!isNaN(idx) && idx !== currentIdx) {
      setManual(true);
      currentIdx = idx;
      render();
    }
  });

  // Keyboard nav (matches present.html keys for muscle memory)
  document.addEventListener("keydown", (e) => {
    if (e.target?.tagName === "INPUT" || e.target?.tagName === "TEXTAREA") return;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
      case "PageDown":
      case "j":
        e.preventDefault();
        setManual(true);
        if (currentIdx < sections.length - 1) currentIdx++;
        render();
        break;
      case "ArrowUp":
      case "ArrowLeft":
      case "PageUp":
      case "k":
        e.preventDefault();
        setManual(true);
        if (currentIdx > 0) currentIdx--;
        render();
        break;
    }
  });

  document.title = deck?.title ? `Script · ${deck.title}` : "Script";
  applyFontSize();
  render();

  // Best-effort: keep mobile screen awake while presenting from it.
  if ("wakeLock" in navigator) {
    navigator.wakeLock.request("screen").catch(() => {});
  }

  return { close: () => sync?.close() };
}
