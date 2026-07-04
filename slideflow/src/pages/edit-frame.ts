import { getPorts } from '@composition/index';
import { tagSection } from '@core/slide/tag-section';
import { injectSlides } from '@core/slide/frame-inject';
import { InlineEditor } from '@features/editor/inline-editor';
import { QueryParams } from '@ui/constants';
import type { DownMessage, UpMessage } from '@features/editor/frame-messages';

const params = new URLSearchParams(location.search);
const deckId = params.get(QueryParams.deck) ?? '';
const sectionId = params.get(QueryParams.section) ?? '';
const editMode = params.get('edit') === '1';

const embedded = window.parent !== window;
let rendered = false;
let inlineEditor: InlineEditor | null = null;

if (embedded) {
  window.addEventListener('message', onParentMessage);
  postUp({ type: 'edit-frame:request-data', deckId, sectionId });
  // Fall back to a direct, RLS-authorized fetch if the parent never answers.
  setTimeout(() => void (rendered || directFetch()), 1500);
} else {
  void directFetch();
}

function onParentMessage(event: MessageEvent<DownMessage>): void {
  const msg = event.data;
  if (msg?.type === 'edit-frame:data') render(msg.frameHtml, msg.content, msg.edit);
  else if (msg?.type === 'edit-frame:insert') inlineEditor?.insertHtml(msg.html);
}

async function directFetch(): Promise<void> {
  if (rendered) return;
  try {
    const ports = getPorts();
    await ports.auth.requireLogin({ redirectTo: location.href });
    const deck = await ports.deckStore.get(deckId);
    const slide = (await ports.slideStore.listByDeck(deckId)).find(
      (s) => s.sectionId === sectionId,
    );
    if (!deck || !slide) throw new Error('Slide not found.');
    render(deck.frameHtml, slide.content, editMode);
  } catch (err) {
    postUp({
      type: 'edit-frame:error',
      message: err instanceof Error ? err.message : 'Frame error',
    });
  }
}

function render(frameHtml: string, content: string, edit: boolean): void {
  rendered = true;
  const doc = injectSlides(frameHtml, tagSection(content, sectionId));
  const html = /^\s*<!doctype/i.test(doc) ? doc : `<!doctype html>${doc}`;
  document.open();
  document.write(html);
  document.close();
  if (edit) mountInlineEditor();
}

function mountInlineEditor(): void {
  const section = document.querySelector<HTMLElement>(`[data-section-id="${sectionId}"]`);
  if (!section) return;
  inlineEditor = new InlineEditor(section, {
    sectionId,
    autosave: true,
    onDirty: () => postUp({ type: 'edit:dirty', sectionId }),
    onSave: (content) => postUp({ type: 'edit:save', sectionId, content }),
  });
}

function postUp(message: UpMessage): void {
  window.parent.postMessage(message, '*');
}
