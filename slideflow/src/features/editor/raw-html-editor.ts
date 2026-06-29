import type { DeckSession } from './deck-session';
import { debounce, type Debounced } from '@ui/debounce';

const SAVE_DEBOUNCE_MS = 800;

/**
 * Raw HTML editing of the current slide's `<section>` (SPEC §9.3 raw HTML mode).
 * Validates that content has an opening and closing section tag before saving;
 * debounced, flushed on slide switch.
 */
export class RawHtmlEditor {
  private readonly save: Debounced<[]>;
  private editingId: string;

  constructor(
    private readonly textarea: HTMLTextAreaElement,
    private readonly session: DeckSession,
    private readonly onError: (message: string) => void,
  ) {
    this.editingId = session.currentSectionId;
    this.save = debounce(() => this.persist(), SAVE_DEBOUNCE_MS);
    this.textarea.addEventListener('input', () => this.save());
    this.session.onChange(() => this.onSelectionChange());
    this.load();
  }

  /** Load the current slide's content (used when entering raw mode). */
  load(): void {
    this.editingId = this.session.currentSectionId;
    this.textarea.value = this.session.current()?.content ?? '';
    this.textarea.disabled = this.editingId === '';
  }

  flush(): void {
    this.save.flush();
  }

  private onSelectionChange(): void {
    if (this.session.currentSectionId === this.editingId) return;
    this.save.flush();
    this.load();
  }

  private persist(): void {
    const sectionId = this.editingId;
    if (!sectionId) return;
    const content = this.textarea.value;
    if (!/<section\b[^>]*>/i.test(content) || !/<\/section>/i.test(content)) {
      this.onError('Content must contain an opening and closing <section> tag.');
      return;
    }
    this.onError('');
    this.session
      .saveContent(sectionId, content)
      .catch((err: unknown) => this.onError(err instanceof Error ? err.message : 'Save failed'));
  }
}
