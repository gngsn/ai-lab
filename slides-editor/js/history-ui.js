// Side-drawer history panel. Reused by edit.html and script-edit.html.
// Renders a merged timeline (slide + notes), filters to current section,
// shows row content on demand, and performs restore via the live repos.
import * as deckRepo from "./repo/deck-repo.js";
import * as historyRepo from "./repo/history-repo.js";
import * as notesRepo from "./repo/notes-repo.js";
import * as slideRepo from "./repo/slide-repo.js";
import { askText } from "./dom-prompt.js";

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const fmtTime = (iso) => {
  const d = new Date(iso);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  return sameDay ? d.toLocaleTimeString() : d.toLocaleString();
};

export class HistoryUI {
  constructor({ deckId, panelEl, currentSectionGetter, onRestored } = {}) {
    this.deckId = deckId;
    this.panelEl = panelEl;
    this.currentSectionGetter = currentSectionGetter || (() => null);
    this.onRestored = onRestored;
    this.filterCurrent = false;
    this.entries = [];
    this.openId = null; // `${source}-${id}` for content viewer
    this.loading = false;
  }

  async refresh() {
    this.loading = true;
    this.render();
    const sid = this.filterCurrent ? this.currentSectionGetter() : null;
    try {
      this.entries = await historyRepo.listAllHistory(
        this.deckId,
        sid ? { sectionId: sid } : {},
      );
    } catch (err) {
      this.panelEl.innerHTML = `<p class="hist-err">${escapeHtml(err.message)}</p>`;
      this.loading = false;
      return;
    }
    this.loading = false;
    this.render();
  }

  render() {
    const filterChecked = this.filterCurrent ? "checked" : "";
    const sid = this.currentSectionGetter();
    const rows = this.entries.length
      ? this.entries.map((e) => this.renderRow(e)).join("")
      : this.loading
        ? '<li class="hist-empty">loading…</li>'
        : '<li class="hist-empty">(no history yet)</li>';

    this.panelEl.innerHTML = `
      <header class="hist-head">
        <strong>History</strong>
        <span style="display:flex;align-items:center;gap:4px;">
          <button class="btn" data-act="refresh">↻</button>
          <button class="btn" data-act="close" aria-label="Close history drawer">×</button>
        </span>
      </header>
      <label class="hist-filter">
        <input type="checkbox" data-act="filter" ${filterChecked} ${sid ? "" : "disabled"} />
        current section only ${sid ? `(<code>${escapeHtml(sid)}</code>)` : ""}
      </label>
      <ul class="hist-list">${rows}</ul>
    `;

    this.panelEl.querySelector('[data-act="refresh"]').onclick = () =>
      this.refresh();
    this.panelEl.querySelector('[data-act="close"]').onclick = () => {
      const drawer = this.panelEl.closest(".hist-drawer");
      drawer?.classList.remove("open");
      document.getElementById("history-toggle")?.classList.remove("active");
    };
    this.panelEl.querySelector('[data-act="filter"]').onchange = (e) => {
      this.filterCurrent = e.target.checked;
      this.refresh();
    };
    this.panelEl.querySelectorAll(".hist-row").forEach((row) => {
      const id = +row.dataset.id;
      const source = row.dataset.source;
      const key = `${source}-${id}`;
      row.querySelector(".h-view").onclick = () => {
        this.openId = this.openId === key ? null : key;
        this.render();
      };
      row.querySelector(".h-restore").onclick = () => this.restore(id, source);
    });
  }

  renderRow(e) {
    const key = `${e._source}-${e.id}`;
    const isOpen = this.openId === key;
    const kind =
      e.kind === "manual"
        ? '<span class="h-kind manual">★</span>'
        : '<span class="h-kind auto">·</span>';
    const src =
      e._source === "slide"
        ? '<span class="h-src slide">slide</span>'
        : e._source === "notes"
          ? '<span class="h-src notes">notes</span>'
          : '<span class="h-src frame">frame</span>';
    const msg = e.message
      ? `<span class="h-msg">${escapeHtml(e.message)}</span>`
      : "";
    const sectionLabel = e._source === "frame" ? "frame" : e.section_id;
    return `
      <li class="hist-row" data-id="${e.id}" data-source="${e._source}">
        <div class="hist-line">
          ${kind}${src}
          <code class="h-sec">${escapeHtml(sectionLabel)}</code>
          <span class="h-time">${escapeHtml(fmtTime(e.created_at))}</span>
          ${msg}
          <span class="h-actions">
            <button class="h-view">${isOpen ? "hide" : "view"}</button>
            <button class="h-restore">restore</button>
          </span>
        </div>
        ${
          isOpen
            ? `<pre class="hist-content">${escapeHtml(e.content).slice(0, 6000)}${e.content.length > 6000 ? "\n… (truncated)" : ""}</pre>`
            : ""
        }
      </li>
    `;
  }

  async restore(id, source) {
    const entry = this.entries.find((e) => e.id === id && e._source === source);
    if (!entry) return;
    const ok = confirm(
      `Restore ${source} for '${entry.section_id}'\n` +
        `to ${fmtTime(entry.created_at)}?`,
    );
    if (!ok) return;
    try {
      if (source === "slide") {
        await slideRepo.updateContent(
          this.deckId,
          entry.section_id,
          entry.content,
        );
      } else if (source === "notes") {
        await notesRepo.upsert(this.deckId, entry.section_id, entry.content);
      } else {
        await deckRepo.updateFrameHtml(this.deckId, entry.content);
      }
      this.onRestored?.({ section_id: entry.section_id, source });
      // Refresh history to show the new auto row created by the restore.
      this.refresh();
    } catch (err) {
      alert("Restore failed: " + err.message);
    }
  }
}

/**
 * Promise<string|null> — prompt for a snapshot message, then write the manual
 * batch. Returns the timestamp string on success, null on cancel.
 */
export async function saveVersionPrompt(deckId) {
  const message = await askText({
    title: "Save Version",
    message: "Snapshot message (optional)",
    defaultValue: "",
  });
  if (message === null) return null;
  const slides = await slideRepo.listByDeck(deckId);
  const notes = await notesRepo.listByDeck(deckId);
  const deck = await deckRepo.getDeck(deckId);
  return historyRepo.appendManualBatch(
    deckId,
    message,
    slides,
    notes,
    deck.frame_html,
  );
}
