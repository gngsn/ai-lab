// Fullscreen note editor — 3-column on desktop, stacked on mobile.
// Used by script-edit.html. Edits hit `notes.upsert` with debounce; switching
// sections always flushes the pending save first.
import { markdownToHtml } from "./markdown-lite.js";
import * as notesRepo from "./repo/notes-repo.js";
import { HistoryUI, saveVersionPrompt } from "./history-ui.js";
import { bindShortcutsHelp } from "./shortcuts-help.js";

const SAVE_DEBOUNCE_MS = 800;

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

export function mountScriptEditView({ deck, deckId, sections }) {
  let currentSid = sections[0]?.section_id || null;
  let pending = null; // { sid, content }
  let saveTimer = 0;

  const $ = (id) => document.getElementById(id);

  function setStatus(text, kind = "") {
    const s = $("status");
    s.textContent = text;
    s.dataset.kind = kind;
  }

  function renderList() {
    $("edit-sections").innerHTML = sections
      .map(
        (s, i) => `
        <div class="edit-sec ${s.section_id === currentSid ? "active" : ""}"
             data-section-id="${escapeHtml(s.section_id)}">
          <span class="o">${i + 1}</span>
          <span class="t">${escapeHtml(s.title || s.section_id)}</span>
        </div>`,
      )
      .join("");
    $("edit-sections").querySelectorAll(".edit-sec").forEach((el) => {
      el.addEventListener("click", () => select(el.dataset.sectionId));
    });
  }

  function renderEditor() {
    const sec = sections.find((s) => s.section_id === currentSid);
    const text = sec?.body || "";
    const ta = $("edit-textarea");
    ta.value = text;
    ta.disabled = !sec;
    updatePreview(text);
    $("edit-heading").textContent = sec?.title || currentSid || "—";
  }

  function updatePreview(text) {
    $("edit-preview").innerHTML = text
      ? markdownToHtml(text)
      : '<p style="opacity:.4">(빈 노트)</p>';
  }

  async function flushSave() {
    if (!pending) return;
    clearTimeout(saveTimer);
    saveTimer = 0;
    const { sid, content } = pending;
    pending = null;
    try {
      await notesRepo.upsert(deckId, sid, content);
      const sec = sections.find((s) => s.section_id === sid);
      if (sec) sec.body = content;
      setStatus(`saved · ${new Date().toLocaleTimeString()}`, "ok");
    } catch (err) {
      setStatus("save failed", "err");
      console.error("[notes-save]", err);
    }
  }

  async function select(sid) {
    if (sid === currentSid) return;
    await flushSave(); // never lose the in-progress edit
    currentSid = sid;
    renderList();
    renderEditor();
  }

  $("edit-textarea").addEventListener("input", (e) => {
    const v = e.target.value;
    updatePreview(v);
    pending = { sid: currentSid, content: v };
    setStatus("saving…");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
  });

  // Header / nav
  document.title = deck?.title ? `Notes · ${deck.title}` : "Notes";
  $("deck-title").textContent = deck?.title || deckId;
  $("read-link").href = `./script.html?deck=${encodeURIComponent(deckId)}`;
  $("present-link").href = `./present.html?deck=${encodeURIComponent(deckId)}`;
  $("slides-link").href = `./edit.html?deck=${encodeURIComponent(deckId)}`;

  $("preview-toggle").addEventListener("click", () => {
    document.body.classList.toggle("hide-preview");
    $("preview-toggle").classList.toggle(
      "active",
      !document.body.classList.contains("hide-preview"),
    );
  });
  // Default: preview visible on desktop, hidden on small screens
  if (window.matchMedia("(max-width: 900px)").matches) {
    document.body.classList.add("hide-preview");
  } else {
    $("preview-toggle").classList.add("active");
  }

  renderList();
  renderEditor();

  // ── history drawer ──────────────────────────────────────────────
  const historyUI = new HistoryUI({
    deckId,
    panelEl: $("history-panel"),
    currentSectionGetter: () => currentSid,
    onRestored: async ({ section_id, source }) => {
      // Refresh local snapshot for the restored section
      if (source === "notes") {
        try {
          const note = await notesRepo.getOne(deckId, section_id);
          const sec = sections.find((s) => s.section_id === section_id);
          if (sec) sec.body = note?.content || "";
        } catch (e) {
          console.warn(e);
        }
      }
      if (section_id === currentSid) renderEditor();
      setStatus("restored", "ok");
    },
  });

  $("history-toggle").addEventListener("click", () => {
    const open = $("hist-drawer").classList.toggle("open");
    $("history-toggle").classList.toggle("active", open);
    if (open) historyUI.refresh();
  });

  $("save-version").addEventListener("click", async () => {
    try {
      await flushSave(); // capture in-progress notes into the snapshot
      const ts = await saveVersionPrompt(deckId);
      if (ts === null) return;
      setStatus("version saved", "ok");
      if ($("hist-drawer").classList.contains("open")) historyUI.refresh();
    } catch (err) {
      setStatus("save version failed", "err");
      console.error(err);
    }
  });

  document.addEventListener("keydown", (e) => {
    if (
      e.target?.tagName === "TEXTAREA" ||
      e.target?.tagName === "INPUT"
    ) {
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        $("save-version").click();
      }
      return;
    }
    if (e.key === "h" || e.key === "H") {
      e.preventDefault();
      $("history-toggle").click();
    } else if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
      e.preventDefault();
      $("save-version").click();
    }
  });

  bindShortcutsHelp("Notes (script-edit)", [
    { keys: ["⌘S", "Ctrl+S"], desc: "Save version (manual snapshot)" },
    { keys: ["H"], desc: "Toggle history drawer" },
    { keys: ["Click section"], desc: "Switch (auto-saves pending edit)" },
    { keys: ["?"], desc: "This help" },
  ]);

  // Best-effort flush on tab close / refresh.
  window.addEventListener("beforeunload", () => {
    if (pending) flushSave();
  });
}
