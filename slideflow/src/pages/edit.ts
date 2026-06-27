import '@ui/styles/edit.css';
import { bootOwnerPage } from './boot';
import { bindAccountMenu } from '@features/auth/account-menu';
import { DeckSession } from '@features/editor/deck-session';
import { SlideList } from '@features/editor/slide-list';
import { NotesEditor } from '@features/editor/notes-editor';
import { RawHtmlEditor } from '@features/editor/raw-html-editor';
import { installPanelResizers } from '@features/editor/panel-resize';
import { el, elOpt } from '@ui/dom';
import { debounce } from '@ui/debounce';
import { QueryParams, StorageKeys } from '@ui/constants';
import { isSlideHiddenContent } from '@core/slide/slide-visibility';
import type { DownMessage, UpMessage } from '@features/editor/frame-messages';

type Mode = 'aspect-169' | 'portrait' | 'html' | 'stretch';

const NOTES_FONT_MIN = 11;
const NOTES_FONT_MAX = 20;

const deckId = new URLSearchParams(location.search).get(QueryParams.deck) ?? '';

let session: DeckSession;
let rawEditor: RawHtmlEditor;
let mode: Mode = 'aspect-169';
let shownSection = '';
let notesFontSize = 14;

void start();

async function start(): Promise<void> {
  const ctx = await bootOwnerPage();
  renderShell();
  bindAccountMenu(ctx.ports, ctx.session);

  session = new DeckSession(ctx.ports, deckId);
  try {
    await session.load();
  } catch (err) {
    el('#app').innerHTML = `<div class="app-placeholder"><h1>Not available</h1><small>${
      err instanceof Error ? err.message : 'Error'
    }</small></div>`;
    return;
  }

  rawEditor = new RawHtmlEditor(el('#html-editor'), session, setError);
  new SlideList(el('#slide-list-items'), session, setError);
  new NotesEditor(el('#notes-textarea'), el('#notes-preview'), session, setError);

  initToolbar();
  initSlideTitle();
  initNotesFontSize();
  initMoreMenu();
  installPanelResizers(el('#body'), el('#slide-list-resizer'), el('#props-resizer'), () => mode);
  window.addEventListener('message', onFrameMessage);
  session.onChange(onSessionChange);

  shownSection = session.currentSectionId;
  applyMode('aspect-169');
  syncMeta();
  reloadCanvas();
}

function renderShell(): void {
  el('#app').innerHTML = `
    <header id="toolbar">
      <a class="btn home" href="index.html" title="Home">🏠</a>
      <input id="deck-title" class="title" type="text" autocomplete="off" />
      <select id="mode-select" class="btn" style="width:auto;min-width:80px">
        <option value="aspect-169">16:9</option>
        <option value="portrait">portrait</option>
        <option value="html">html</option>
        <option value="stretch">stretch</option>
      </select>
      <span class="spacer"></span>
      <a class="btn" id="present-link" target="_blank">▶ Present</a>
      <details class="dropdown" id="more-dropdown">
        <summary class="btn">⋮ More</summary>
        <div class="dropdown-menu">
          <button id="save-version" type="button">★ Save version</button>
          <button data-export="html" type="button">⬇ Export HTML</button>
          <button data-export="pdf" type="button">⬇ Export PDF</button>
          <button data-export="pptx" type="button">⬇ Export PPTX</button>
          <button data-export="md" type="button">⬇ Notes (.md)</button>
          <button id="history-toggle" type="button">⏱ History</button>
          <button id="frame-edit" type="button">Frame…</button>
          <button id="share-btn" type="button">🔗 Share</button>
          <button id="svg-btn" type="button">✦ SVG</button>
          <button id="images-btn" type="button">🖼 Images</button>
        </div>
      </details>
      <span id="status">—</span>
      <span class="account-menu">
        <span id="account-email"></span>
        <button id="logout-btn" class="btn">Log out</button>
      </span>
    </header>
    <main id="body">
      <aside id="slide-list">
        <div id="slide-list-resizer" aria-hidden="true"></div>
        <div id="slide-list-scroll">
          <div class="slide-list-meta">
            <div class="slide-list-meta-top">
              <h3>Slides</h3>
              <span class="slide-list-count" id="slide-list-count">0</span>
            </div>
            <label class="slide-list-title-label">
              Title
              <input id="slide-list-title" class="slide-list-title-input" type="text"
                     placeholder="Select a slide" autocomplete="off" />
            </label>
            <div class="slide-list-info" id="slide-list-info"></div>
          </div>
          <div id="slide-list-items" class="slide-list-items"></div>
          <button id="add-slide" type="button">+ Add slide</button>
        </div>
      </aside>
      <div id="canvas-wrap">
        <div id="canvas-stage"><iframe id="canvas" src="about:blank"></iframe></div>
        <textarea id="html-editor" spellcheck="false" placeholder="<section ...>...</section>"></textarea>
      </div>
      <aside id="props">
        <div id="props-resizer" aria-hidden="true"></div>
        <div class="notes-header">
          <h3>Notes</h3>
          <div class="notes-controls">
            <button class="btn notes-size-btn" id="notes-size-down" type="button">-</button>
            <button class="btn notes-size-btn" id="notes-size-up" type="button">+</button>
          </div>
        </div>
        <div class="field notes-only">
          <textarea id="notes-textarea" spellcheck="false"
            placeholder="Speaker notes for this slide (Markdown). Autosaves after 800ms."></textarea>
        </div>
        <div id="edit-error" class="edit-error"></div>
        <div id="notes-preview"></div>
        <div id="training-mount"></div>
      </aside>
    </main>
    <div id="toast"></div>`;
}

function initToolbar(): void {
  const deckTitle = el<HTMLInputElement>('#deck-title');
  deckTitle.value = session.deck.title;
  const saveDeckTitle = debounce(() => {
    void session.saveDeckTitle(deckTitle.value).catch((e: unknown) => setError(asMessage(e)));
  }, 600);
  deckTitle.addEventListener('input', () => saveDeckTitle());
  deckTitle.addEventListener('blur', () => saveDeckTitle.flush());

  const room = `r${deckId.slice(0, 6)}`;
  el<HTMLAnchorElement>('#present-link').href =
    `present.html?deck=${encodeURIComponent(deckId)}&sync=${room}`;

  const modeSelect = el<HTMLSelectElement>('#mode-select');
  modeSelect.addEventListener('change', () => applyMode(modeSelect.value as Mode));
}

function initSlideTitle(): void {
  const titleInput = el<HTMLInputElement>('#slide-list-title');
  const save = debounce(() => {
    const id = session.currentSectionId;
    if (id) void session.saveTitle(id, titleInput.value).catch((e: unknown) => setError(asMessage(e)));
  }, 600);
  titleInput.addEventListener('input', () => save());
  titleInput.addEventListener('blur', () => save.flush());
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save.flush();
    }
  });

  el('#add-slide').addEventListener('click', () => {
    void session.addSlide().catch((e: unknown) => setError(asMessage(e)));
  });
}

function initNotesFontSize(): void {
  notesFontSize = clampFont(Number(localStorage.getItem(StorageKeys.notesFontSize)) || 14);
  applyNotesFontSize();
  el('#notes-size-down').addEventListener('click', () => bumpFont(-1));
  el('#notes-size-up').addEventListener('click', () => bumpFont(1));
}

function bumpFont(delta: number): void {
  notesFontSize = clampFont(notesFontSize + delta);
  localStorage.setItem(StorageKeys.notesFontSize, String(notesFontSize));
  applyNotesFontSize();
}

function applyNotesFontSize(): void {
  document.documentElement.style.setProperty('--notes-font-size', `${notesFontSize}px`);
}

function clampFont(value: number): number {
  return Math.max(NOTES_FONT_MIN, Math.min(NOTES_FONT_MAX, value));
}

/** Phase 5 features (frame/history/images/svg/share/export) are not wired yet. */
function initMoreMenu(): void {
  const pending = ['#save-version', '#history-toggle', '#frame-edit', '#share-btn', '#svg-btn', '#images-btn'];
  for (const selector of pending) {
    elOpt(selector)?.addEventListener('click', () => toast('Available in a later phase'));
  }
  for (const btn of document.querySelectorAll('[data-export]')) {
    btn.addEventListener('click', () => toast('Export lands in a later phase'));
  }
}

function applyMode(next: Mode): void {
  mode = next;
  el<HTMLSelectElement>('#mode-select').value = next;
  const body = el('#body');
  const wrap = el('#canvas-wrap');
  body.classList.toggle('portrait-mode', mode === 'portrait');
  body.classList.toggle('html-mode', mode === 'html');
  wrap.classList.toggle('html-mode', mode === 'html');
  wrap.classList.toggle('aspect-169', mode === 'aspect-169' || mode === 'portrait');
  if (mode === 'html') rawEditor.load();
  else reloadCanvas();
}

function onSessionChange(): void {
  syncMeta();
  if (session.currentSectionId === shownSection) return;
  shownSection = session.currentSectionId;
  if (mode !== 'html') reloadCanvas();
}

function syncMeta(): void {
  const count = elOpt('#slide-list-count');
  if (count) count.textContent = String(session.slides.length);

  const titleInput = elOpt<HTMLInputElement>('#slide-list-title');
  const current = session.current();
  if (titleInput && document.activeElement !== titleInput) {
    titleInput.value = current?.title ?? '';
  }

  const info = elOpt('#slide-list-info');
  if (info) {
    info.innerHTML = current
      ? infoRow('ID', current.sectionId) +
        infoRow('Order', String(session.slides.indexOf(current) + 1)) +
        infoRow('Hidden', isSlideHiddenContent(current.content) ? 'yes' : 'no')
      : '';
  }
}

function infoRow(key: string, value: string): string {
  return `<div class="slide-list-info-row"><span class="k">${key}</span><span class="v">${escapeHtml(
    value,
  )}</span></div>`;
}

function reloadCanvas(): void {
  const frame = el<HTMLIFrameElement>('#canvas');
  frame.src = session.currentSectionId
    ? `edit-frame.html?deck=${encodeURIComponent(deckId)}&section=${encodeURIComponent(
        session.currentSectionId,
      )}&edit=1`
    : 'about:blank';
}

function onFrameMessage(event: MessageEvent<UpMessage>): void {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'edit-frame:request-data') sendFrameData(msg.sectionId);
  else if (msg.type === 'edit:save') {
    void session
      .saveContent(msg.sectionId, msg.content)
      .then(() => setStatus('Saved', 'ok'))
      .catch((e: unknown) => setError(asMessage(e)));
  } else if (msg.type === 'edit:dirty') setStatus('Editing…');
  else if (msg.type === 'edit-frame:error') setError(msg.message);
}

function sendFrameData(sectionId: string): void {
  const slide = session.slides.find((s) => s.sectionId === sectionId);
  const frame = el<HTMLIFrameElement>('#canvas');
  if (!slide || !frame.contentWindow) return;
  const message: DownMessage = {
    type: 'edit-frame:data',
    frameHtml: session.deck.frameHtml,
    content: slide.content,
    edit: true,
  };
  frame.contentWindow.postMessage(message, '*');
}

function setStatus(message: string, kind: 'ok' | 'err' | '' = ''): void {
  const node = elOpt('#status');
  if (!node) return;
  node.textContent = message;
  if (kind) node.dataset.kind = kind;
  else delete node.dataset.kind;
}

function setError(message: string): void {
  const node = elOpt('#edit-error');
  if (node) node.textContent = message;
  if (message) setStatus(message, 'err');
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(message: string): void {
  const node = el('#toast');
  node.textContent = message;
  node.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 2000);
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Error';
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string,
  );
}
