import type { BlobStoragePort, BlobObject } from '@ports/blob-storage-port';

/**
 * Images modal (SPEC §9.3): list/upload/copy/insert/delete deck images. Insert
 * places an `<img>` into the current slide via the provided callback.
 */
export function openImagesModal(
  blob: BlobStoragePort,
  deckId: string,
  insert: (html: string) => void,
  onError: (message: string) => void,
): void {
  const bg = document.createElement('div');
  bg.className = 'modal-bg show';
  bg.innerHTML = `
    <div class="modal" style="width:min(820px,92vw);height:min(640px,88vh)">
      <header style="display:flex;align-items:center;gap:8px">
        <h2>Images</h2>
        <span style="flex:1"></span>
        <button class="btn" id="images-upload-btn">+ Upload</button>
        <input type="file" id="images-upload-input" accept="image/*" multiple hidden />
        <button class="btn" id="images-close">Close</button>
      </header>
      <div id="images-grid" class="image-grid"></div>
    </div>`;
  document.body.appendChild(bg);

  const grid = bg.querySelector<HTMLElement>('#images-grid')!;
  const fileInput = bg.querySelector<HTMLInputElement>('#images-upload-input')!;
  const close = () => bg.remove();
  const fail = (err: unknown) => onError(err instanceof Error ? err.message : 'Image error');

  const refresh = () => {
    blob
      .list(deckId)
      .then((images) => (grid.innerHTML = images.map(cardHtml).join('') || emptyHtml()))
      .catch(fail);
  };

  bg.querySelector('#images-upload-btn')!.addEventListener('click', () => fileInput.click());
  bg.querySelector('#images-close')!.addEventListener('click', close);
  bg.addEventListener('click', (e) => {
    if (e.target === bg) close();
  });

  fileInput.addEventListener('change', () => {
    const files = [...(fileInput.files ?? [])];
    if (!files.length) return;
    Promise.all(files.map((f) => blob.upload(deckId, f)))
      .then(refresh)
      .catch(fail);
  });

  grid.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>('.img-card');
    if (!card) return;
    const url = card.dataset.url ?? '';
    const path = card.dataset.path ?? '';
    if (target.dataset.act === 'copy') void navigator.clipboard.writeText(url);
    else if (target.dataset.act === 'insert') insert(`<img src="${url}" alt="" />`);
    else if (target.dataset.act === 'delete') {
      if (confirm('Delete this image?')) blob.remove(path).then(refresh).catch(fail);
    }
  });

  refresh();
}

function cardHtml(image: BlobObject): string {
  return `
    <div class="img-card" data-url="${escapeAttr(image.url)}" data-path="${escapeAttr(image.path)}">
      <div class="thumb"><img src="${escapeAttr(image.url)}" alt="" loading="lazy" /></div>
      <div class="img-actions">
        <button data-act="insert" title="Insert">+</button>
        <button data-act="copy" title="Copy URL">⧉</button>
        <button data-act="delete" title="Delete">✕</button>
      </div>
    </div>`;
}

function emptyHtml(): string {
  return '<p style="color:var(--text-mid);padding:16px">No images yet. Upload to get started.</p>';
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, '&quot;');
}
