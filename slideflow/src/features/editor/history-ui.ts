import type { DeckSession } from './deck-session';
import type { HistoryEntry } from '@core/model/history';

const PREVIEW_LIMIT = 6000;

/**
 * History drawer (SPEC §11): merged slide/notes/frame history, newest first.
 * Manual rows show ★, auto rows ·. Filter to the current section, preview content,
 * and restore (which writes back and creates a fresh auto snapshot).
 */
export function openHistoryDrawer(session: DeckSession, onError: (message: string) => void): void {
  let filterToSection = false;

  const drawer = document.createElement('div');
  drawer.className = 'hist-drawer show';
  drawer.innerHTML = `
    <div class="hist-head">
      <h3>History</h3>
      <label class="hist-filter"><input type="checkbox" id="hist-filter" /> This slide only</label>
      <button class="btn" id="hist-version">★ Save version</button>
      <button class="btn" id="hist-close">✕</button>
    </div>
    <div id="hist-list" class="hist-list"></div>`;
  document.body.appendChild(drawer);

  const list = drawer.querySelector<HTMLElement>('#hist-list')!;
  const close = () => drawer.remove();
  const byId = new Map<number, HistoryEntry>();

  const refresh = () => {
    const sectionId = filterToSection ? session.currentSectionId : undefined;
    session
      .listHistory(sectionId)
      .then((entries) => {
        byId.clear();
        for (const e of entries) byId.set(e.id, e);
        list.innerHTML =
          entries.map(rowHtml).join('') || '<p class="hist-empty">No history yet.</p>';
      })
      .catch((err: unknown) => onError(err instanceof Error ? err.message : 'History load failed'));
  };

  list.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('.hist-row');
    if (!row) return;
    const entry = byId.get(Number(row.dataset.id));
    if (!entry) return;
    if (target.dataset.act === 'view') {
      const preview = row.querySelector<HTMLElement>('.hist-preview');
      if (preview) preview.hidden = !preview.hidden;
    } else if (target.dataset.act === 'restore') {
      if (!confirm('Restore this version?')) return;
      void session
        .restore(entry.source, entry.sectionId, entry.content)
        .then(refresh)
        .catch((err: unknown) => onError(err instanceof Error ? err.message : 'Restore failed'));
    }
  });

  drawer.querySelector('#hist-filter')!.addEventListener('change', (e) => {
    filterToSection = (e.target as HTMLInputElement).checked;
    refresh();
  });
  drawer.querySelector('#hist-version')!.addEventListener('click', () => {
    const message = prompt('Version message (optional):') ?? '';
    void session
      .saveVersion(message)
      .then(refresh)
      .catch((err: unknown) => onError(err instanceof Error ? err.message : 'Save version failed'));
  });
  drawer.querySelector('#hist-close')!.addEventListener('click', close);

  refresh();
}

function rowHtml(entry: HistoryEntry): string {
  const mark = entry.kind === 'manual' ? '★' : '·';
  const when = entry.createdAt.replace('T', ' ').slice(0, 16);
  return `
    <div class="hist-row" data-id="${entry.id}">
      <div class="hist-row-top">
        <span class="hist-mark">${mark}</span>
        <span class="hist-source">${entry.source}</span>
        <span class="hist-when">${when}</span>
        <span style="flex:1"></span>
        <button class="hist-link" data-act="view">view</button>
        <button class="hist-link" data-act="restore">restore</button>
      </div>
      ${entry.message ? `<div class="hist-msg">${escapeHtml(entry.message)}</div>` : ''}
      <pre class="hist-preview" hidden>${escapeHtml(entry.content.slice(0, PREVIEW_LIMIT))}</pre>
    </div>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string,
  );
}
