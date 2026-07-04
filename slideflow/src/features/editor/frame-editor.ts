import type { DeckSession } from './deck-session';
import { parseFrame, serializeFrame, type FrameParts } from '@core/slide/frame-parse';

type Part = keyof FrameParts;
const PARTS: { key: Part; label: string }[] = [
  { key: 'html', label: 'HTML' },
  { key: 'css', label: 'CSS' },
  { key: 'js', label: 'JS' },
];

/**
 * Frame editor modal (SPEC §9.3): edit the deck shell as separate HTML / CSS / JS,
 * reassembled on save (CSS → head, JS → body, `<!-- slides -->` ensured).
 */
export function openFrameEditor(session: DeckSession, onError: (message: string) => void): void {
  const parts = parseFrame(session.deck.frameHtml);
  let active: Part = 'html';

  const bg = document.createElement('div');
  bg.className = 'modal-bg show';
  bg.innerHTML = `
    <div class="modal" style="width:min(1100px,94vw);height:min(80vh,820px)">
      <h2>Edit frame</h2>
      <div class="frame-body">
        <aside class="frame-sidebar">
          ${PARTS.map(
            (p) =>
              `<button class="btn frame-part-btn${p.key === active ? ' active' : ''}" data-frame-part="${p.key}">${p.label}</button>`,
          ).join('')}
        </aside>
        <textarea id="frame-textarea" spellcheck="false"></textarea>
      </div>
      <div class="actions">
        <span style="flex:1"></span>
        <button class="btn" id="frame-cancel">Cancel</button>
        <button class="btn btn-primary" id="frame-save">Save</button>
      </div>
    </div>`;
  document.body.appendChild(bg);

  const textarea = bg.querySelector<HTMLTextAreaElement>('#frame-textarea')!;
  const close = () => bg.remove();
  const load = () => (textarea.value = parts[active]);
  const stash = () => (parts[active] = textarea.value);
  load();

  for (const button of bg.querySelectorAll<HTMLElement>('[data-frame-part]')) {
    button.addEventListener('click', () => {
      stash();
      active = button.dataset.framePart as Part;
      bg.querySelectorAll('[data-frame-part]').forEach((b) =>
        b.classList.toggle('active', b === button),
      );
      load();
    });
  }

  bg.querySelector('#frame-cancel')!.addEventListener('click', close);
  bg.addEventListener('click', (e) => {
    if (e.target === bg) close();
  });
  bg.querySelector('#frame-save')!.addEventListener('click', () => {
    stash();
    session
      .saveFrame(serializeFrame(parts))
      .then(close)
      .catch((err: unknown) => onError(err instanceof Error ? err.message : 'Frame save failed'));
  });
}
