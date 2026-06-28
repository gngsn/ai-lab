import '@ui/styles/dashboard.css';
import { bootOwnerPage } from './boot';
import { bindAccountMenu } from '@features/auth/account-menu';
import { importDeck } from '@features/import/import-html';
import { el, elOpt } from '@ui/dom';
import { env } from '@composition/env';
import type { Deck } from '@core/model/deck';
import type { OwnerPageContext } from './boot';

void start();

async function start(): Promise<void> {
  const ctx = await bootOwnerPage();
  renderShell();
  bindAccountMenu(ctx.ports, ctx.session);
  setStatus(`Connected · ${env.backend}`);
  await refreshDeckList(ctx);
  wireImport(ctx);
}

function renderShell(): void {
  el('#app').innerHTML = `
    <div class="dash">
      <div class="dash-top">
        <h1>Slideflow</h1>
        <button id="import-html-btn" class="btn btn-primary">Import HTML</button>
        <div class="account-menu">
          <span id="account-email"></span>
          <button id="logout-btn" class="btn">Log out</button>
        </div>
      </div>
      <div id="status" class="dash-status"></div>
      <div id="deck-list" class="deck-list"></div>
    </div>
    <div id="import-modal-bg" class="modal-bg">
      <form id="import-form" class="modal">
        <h2>Import deck from HTML</h2>
        <label for="import-file">HTML file</label>
        <input id="import-file" type="file" accept=".html,text/html" required />
        <label for="import-deck-id">Deck id</label>
        <input id="import-deck-id" type="text" placeholder="my-deck" required />
        <label for="import-title">Title</label>
        <input id="import-title" type="text" placeholder="My Deck" />
        <label for="import-notes-file">Notes Markdown (optional)</label>
        <input id="import-notes-file" type="file" accept=".md,text/markdown" />
        <div class="modal-actions">
          <button id="import-run-btn" type="submit" class="btn btn-primary">Import</button>
          <button id="import-cancel-btn" type="button" class="btn">Cancel</button>
        </div>
        <div id="import-error" class="modal-error"></div>
      </form>
    </div>`;
}

async function refreshDeckList(ctx: OwnerPageContext): Promise<void> {
  const decks = await ctx.ports.deckStore.listByOwner(ctx.session.user.id);
  const list = el('#deck-list');
  if (decks.length === 0) {
    list.innerHTML = `<div class="deck-empty">No decks yet. Import one to get started.</div>`;
    return;
  }
  list.innerHTML = decks.map(deckCard).join('');
}

function deckCard(deck: Deck): string {
  const id = encodeURIComponent(deck.deckId);
  const room = `r${deck.deckId.slice(0, 6)}`;
  const shared = deck.shareToken
    ? ` · <a href="view.html?deck=${id}&token=${encodeURIComponent(deck.shareToken)}">Shared view</a>`
    : '';
  return `
    <div class="deck-card">
      <h2>${escapeHtml(deck.title)}</h2>
      <div class="deck-links">
        <a href="edit.html?deck=${id}">Edit</a>
        <a href="present.html?deck=${id}&sync=${room}">Present</a>
        <a href="note.html?deck=${id}&sync=${room}">Notes</a>
        <a href="training.html?deck=${id}">Train</a>${shared}
      </div>
    </div>`;
}

function wireImport(ctx: OwnerPageContext): void {
  const modal = el('#import-modal-bg');
  const open = () => modal.classList.add('open');
  const close = () => modal.classList.remove('open');

  el('#import-html-btn').addEventListener('click', open);
  el('#import-cancel-btn').addEventListener('click', close);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) close();
  });

  el<HTMLFormElement>('#import-form').addEventListener('submit', (event) => {
    event.preventDefault();
    setError('');
    runImport(ctx).catch((err: unknown) =>
      setError(err instanceof Error ? err.message : 'Import failed'),
    );
  });
}

async function runImport(ctx: OwnerPageContext): Promise<void> {
  const html = await readFile(el<HTMLInputElement>('#import-file'));
  if (!html) throw new Error('Choose an HTML file to import.');
  const deckId = el<HTMLInputElement>('#import-deck-id').value.trim();
  if (!deckId) throw new Error('Enter a deck id.');
  const title = el<HTMLInputElement>('#import-title').value.trim() || 'Untitled';
  const notesMd = (await readFile(el<HTMLInputElement>('#import-notes-file'))) || undefined;

  await importDeck(ctx.ports, ctx.session.user, { deckId, title, html, notesMd });
  location.assign(`edit.html?deck=${encodeURIComponent(deckId)}`);
}

async function readFile(input: HTMLInputElement): Promise<string> {
  const file = input.files?.[0];
  return file ? file.text() : '';
}

function setStatus(message: string): void {
  const node = elOpt('#status');
  if (node) node.textContent = message;
}

function setError(message: string): void {
  const node = elOpt('#import-error');
  if (node) node.textContent = message;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string,
  );
}
