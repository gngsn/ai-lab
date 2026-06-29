import type { DeckSession } from './deck-session';
import { debounce, type Debounced } from '@ui/debounce';

const SAVE_DEBOUNCE_MS = 800;

/**
 * Binds the notes textarea to the current slide (SPEC §9.3). Saves are debounced;
 * switching slides flushes the pending save first.
 */
export class NotesEditor {
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
    window.addEventListener('beforeunload', () => this.save.flush());
    this.session.onChange(() => this.onSelectionChange());
    this.load();
  }

  private onSelectionChange(): void {
    if (this.session.currentSectionId === this.editingId) return;
    this.save.flush();
    this.editingId = this.session.currentSectionId;
    this.load();
  }

  private load(): void {
    this.textarea.value = this.session.noteOf(this.editingId);
    this.textarea.disabled = this.editingId === '';
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
