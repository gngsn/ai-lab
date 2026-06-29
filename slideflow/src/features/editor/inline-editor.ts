import { debounce, type Debounced } from '@ui/debounce';

const AUTO_MARK_SELECTOR = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,span,div';
const SAVE_DEBOUNCE_MS = 800;

export interface InlineEditorOptions {
  sectionId: string;
  autosave: boolean;
  onDirty: () => void;
  onSave: (content: string) => void;
}

/**
 * Makes a rendered slide section editable in place (SPEC §9.3 inline editing).
 * Marks `[data-editable="true"]` nodes contenteditable (auto-marking leaf text
 * elements if none are tagged), forces plain-text paste, and reports dirty/save.
 */
export class InlineEditor {
  private readonly save: Debounced<[]>;
  private readonly editables: HTMLElement[];

  constructor(
    private readonly section: HTMLElement,
    private readonly opts: InlineEditorOptions,
  ) {
    this.save = debounce(() => this.opts.onSave(this.serialize()), SAVE_DEBOUNCE_MS);
    this.editables = this.markEditables();
    this.attach();
  }

  destroy(): void {
    this.save.cancel();
  }

  private markEditables(): HTMLElement[] {
    const tagged = [...this.section.querySelectorAll<HTMLElement>('[data-editable="true"]')];
    const targets = tagged.length > 0 ? tagged : this.autoMark();
    targets.forEach((node, index) => {
      node.contentEditable = 'true';
      if (!node.dataset.editId) node.dataset.editId = `${this.opts.sectionId}-${pad2(index + 1)}`;
    });
    return targets;
  }

  private autoMark(): HTMLElement[] {
    return [...this.section.querySelectorAll<HTMLElement>(AUTO_MARK_SELECTOR)].filter(
      (node) => node.children.length === 0 && (node.textContent ?? '').trim().length > 0,
    );
  }

  private attach(): void {
    for (const node of this.editables) {
      node.addEventListener('input', this.onInput);
      node.addEventListener('paste', this.onPaste);
    }
  }

  private onInput = (): void => {
    this.opts.onDirty();
    if (this.opts.autosave) this.save();
  };

  private onPaste = (event: ClipboardEvent): void => {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    this.section.ownerDocument.execCommand('insertText', false, text);
  };

  /** Section HTML with the transient contenteditable attribute removed. */
  private serialize(): string {
    const clone = this.section.cloneNode(true) as HTMLElement;
    clone.removeAttribute('contenteditable');
    for (const node of clone.querySelectorAll('[contenteditable]')) {
      node.removeAttribute('contenteditable');
    }
    return clone.outerHTML;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
