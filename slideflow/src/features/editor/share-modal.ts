import type { DeckSession } from './deck-session';

/**
 * Share link modal (SPEC §9.3 share): generate / copy / rotate / revoke the deck's
 * share token. The token drives `view.html?deck=…&token=…` (read-only, no notes).
 */
export function openShareModal(session: DeckSession, onError: (message: string) => void): void {
  const run = (promise: Promise<void>) =>
    promise.catch((err: unknown) => onError(err instanceof Error ? err.message : 'Share failed'));

  const bg = document.createElement('div');
  bg.className = 'modal-bg show';
  bg.innerHTML = `
    <div class="modal" style="height:auto;width:min(560px,90vw);gap:12px">
      <h2>Share link</h2>
      <p>Anyone with this link can view the slides read-only. Notes stay private.
         Rotating invalidates previous links.</p>
      <div class="field">
        <label>Share URL</label>
        <input id="share-url" readonly />
      </div>
      <div class="actions">
        <button class="btn danger" id="share-revoke">Revoke</button>
        <button class="btn" id="share-rotate">↻ Rotate</button>
        <span style="flex:1"></span>
        <button class="btn" id="share-copy">Copy link</button>
        <button class="btn" id="share-close">Close</button>
      </div>
    </div>`;
  document.body.appendChild(bg);

  const urlInput = bg.querySelector<HTMLInputElement>('#share-url')!;
  const close = () => bg.remove();

  const refresh = () => {
    const token = session.deck.shareToken;
    urlInput.value = token
      ? new URL(
          `view.html?deck=${encodeURIComponent(session.deckId)}&token=${encodeURIComponent(token)}`,
          location.href,
        ).href
      : '(revoked — rotate to generate a link)';
  };

  const ensureToken = async () => {
    if (!session.deck.shareToken) await session.setShareToken(crypto.randomUUID());
    refresh();
  };

  void run(ensureToken());

  bg.querySelector('#share-rotate')!.addEventListener('click', () =>
    run(session.setShareToken(crypto.randomUUID()).then(refresh)),
  );
  bg.querySelector('#share-revoke')!.addEventListener('click', () =>
    run(session.setShareToken(null).then(refresh)),
  );
  bg.querySelector('#share-copy')!.addEventListener('click', () => {
    if (urlInput.value.startsWith('http')) void navigator.clipboard.writeText(urlInput.value);
  });
  bg.querySelector('#share-close')!.addEventListener('click', close);
  bg.addEventListener('click', (e) => {
    if (e.target === bg) close();
  });
}
