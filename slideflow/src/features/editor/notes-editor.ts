import type { DeckSession } from './deck-session';
import { renderMarkdown } from '@core/markdown/markdown-lite';
import { debounce, type Debounced } from '@ui/debounce';

const SAVE_DEBOUNCE_MS = 800;

/**
 * Binds the notes textarea + markdown preview to the current slide (SPEC §9.3,
 * §9.7). Saves are debounced; switching slides flushes the pending save first.
 */
export class NotesEditor {
  private readonly save: Debounced<[]>;
  private editingId: string;

  constructor(
    private readonly textarea: HTMLTextAreaElement,
    private readonly preview: HTMLElement,
    private readonly session: DeckSession,
    private readonly onError: (message: string) => void,
  ) {
    this.editingId = session.currentSectionId;
    this.save = debounce(() => this.persist(), SAVE_DEBOUNCE_MS);
    this.textarea.addEventListener('input', this.onInput);
    window.addEventListener('beforeunload', () => this.save.flush());
    this.session.onChange(() => this.onSelectionChange());
    this.load();
  }

  private onInput = (): void => {
    this.renderPreview();
    this.save();
  };

  private onSelectionChange(): void {
    if (this.session.currentSectionId === this.editingId) return;
    this.save.flush();
    this.editingId = this.session.currentSectionId;
    this.load();
  }

  private load(): void {
    this.textarea.value = this.session.noteOf(this.editingId);
    this.textarea.disabled = this.editingId === '';
    this.renderPreview();
  }

  private renderPreview(): void {
    this.preview.innerHTML = renderMarkdown(this.textarea.value);
  }

  private persist(): void {
    const sectionId = this.editingId;
    if (!sectionId) return;
    this.session
      .saveNote(sectionId, this.textarea.value)
      .catch((err: unknown) =>
        this.onError(err instanceof Error ? err.message : 'Note save failed'),
      );
  }
}
