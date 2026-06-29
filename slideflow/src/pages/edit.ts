import '@ui/styles/edit.css';
import { bootOwnerPage } from './boot';
import { bindAccountMenu } from '@features/auth/account-menu';
import { DeckSession } from '@features/editor/deck-session';
import { SlideList } from '@features/editor/slide-list';
import { NotesEditor } from '@features/editor/notes-editor';
import { RawHtmlEditor } from '@features/editor/raw-html-editor';
import { el, elOpt } from '@ui/dom';
import { debounce } from '@ui/debounce';
import { QueryParams } from '@ui/constants';
import type { DownMessage, UpMessage } from '@features/editor/frame-messages';

type Mode = 'aspect-169' | 'portrait' | 'html' | 'stretch';

const deckId = new URLSearchParams(location.search).get(QueryParams.deck) ?? '';

let session: DeckSession;
let rawEditor: RawHtmlEditor;
let mode: Mode = 'aspect-169';
let shownSection = '';

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
  window.addEventListener('message', onFrameMessage);
  session.onChange(onSessionChange);

  shownSection = session.currentSectionId;
  syncToolbarTitles();
  reloadCanvas();
}

function renderShell(): void {
  el('#app').innerHTML = `
    <div class="edit-toolbar">
      <a class="home" href="index.html">← Home</a>
      <input id="deck-title" type="text" />
      <select id="mode-select">
        <option value="aspect-169">16:9</option>
        <option value="portrait">Portrait</option>
        <option value="html">HTML</option>
        <option value="stretch">Stretch</option>
      </select>
      <a id="present-link" class="btn" target="_blank">Present</a>
      <span class="spacer"></span>
      <div class="account-menu">
        <span id="account-email"></span>
        <button id="logout-btn" class="btn">Log out</button>
      </div>
      <span id="status"></span>
    </div>
    <div class="edit-body">
      <div id="slide-list"><div id="slide-list-items"></div></div>
      <div id="canvas-wrap">
        <div id="canvas-stage"><iframe id="canvas"></iframe></div>
        <textarea id="html-editor" spellcheck="false"></textarea>
      </div>
      <div id="props">
        <input id="slide-list-title" type="text" placeholder="Slide title" />
        <div class="props-label">Notes</div>
        <textarea id="notes-textarea" spellcheck="false"></textarea>
        <div id="edit-error" class="edit-error"></div>
        <div id="notes-preview"></div>
      </div>
    </div>`;
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
    if (id) {
      void session.saveTitle(id, titleInput.value).catch((e: unknown) => setError(asMessage(e)));
    }
  }, 600);
  titleInput.addEventListener('input', () => save());
  titleInput.addEventListener('blur', () => save.flush());
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      save.flush();
    }
  });
}

function applyMode(next: Mode): void {
  mode = next;
  const wrap = el('#canvas-wrap');
  wrap.classList.toggle('html-mode', mode === 'html');
  wrap.classList.toggle('portrait', mode === 'portrait');
  wrap.classList.toggle('stretch', mode === 'stretch');
  if (mode === 'html') rawEditor.load();
  else reloadCanvas();
}

function onSessionChange(): void {
  if (session.currentSectionId === shownSection) return;
  shownSection = session.currentSectionId;
  syncToolbarTitles();
  if (mode !== 'html') reloadCanvas();
}

function syncToolbarTitles(): void {
  const titleInput = elOpt<HTMLInputElement>('#slide-list-title');
  if (titleInput) titleInput.value = session.current()?.title ?? '';
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
      .then(() => setStatus('Saved'))
      .catch((e: unknown) => setError(asMessage(e)));
  } else if (msg.type === 'edit:dirty') setStatus('Editing…');
  else if (msg.type === 'edit-frame:error') setStatus(msg.message);
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

function setStatus(message: string): void {
  const node = elOpt('#status');
  if (node) node.textContent = message;
}

function setError(message: string): void {
  const node = elOpt('#edit-error');
  if (node) node.textContent = message;
}

function asMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Error';
}
