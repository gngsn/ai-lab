import type { DeckSession } from './deck-session';
import { isSlideHiddenContent } from '@core/slide/slide-visibility';

/**
 * Renders the slide list and wires add/duplicate/delete/hide + drag reorder
 * against the DeckSession (SPEC §9.3). Re-renders on any session change.
 */
export class SlideList {
  private dragId: string | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly session: DeckSession,
    private readonly onError: (message: string) => void,
  ) {
    this.session.onChange(() => this.render());
    this.container.addEventListener('click', this.onClick);
    this.container.addEventListener('dragstart', this.onDragStart);
    this.container.addEventListener('dragover', this.onDragOver);
    this.container.addEventListener('drop', this.onDrop);
    this.render();
  }

  private render(): void {
    const items = this.session.slides
      .map((slide, index) => {
        const hidden = isSlideHiddenContent(slide.content);
        const active = slide.sectionId === this.session.currentSectionId;
        return `
          <div class="slide-item${active ? ' active' : ''}" draggable="true"
               data-section-id="${slide.sectionId}" data-hidden="${hidden}">
            <span class="slide-item-no">${index + 1}</span>
            <span class="slide-item-title">${escapeHtml(slide.title)}</span>
            <span class="slide-item-actions">
              <button data-act="hide" title="Show/hide">${hidden ? '○' : '●'}</button>
              <button data-act="dup" title="Duplicate">⧉</button>
              <button data-act="del" title="Delete">✕</button>
            </span>
          </div>`;
      })
      .join('');
    this.container.innerHTML = `${items}<button id="add-slide" class="add-slide">+ Add slide</button>`;
  }

  private onClick = (event: MouseEvent): void => {
    const target = event.target as HTMLElement;
    if (target.id === 'add-slide') {
      this.run(this.session.addSlide());
      return;
    }
    const item = target.closest<HTMLElement>('.slide-item');
    if (!item) return;
    const sectionId = item.dataset.sectionId ?? '';
    const action = target.dataset.act;
    if (action === 'hide') this.run(this.session.toggleHidden(sectionId));
    else if (action === 'dup') this.run(this.session.duplicateSlide(sectionId));
    else if (action === 'del') this.confirmDelete(sectionId);
    else this.session.select(sectionId);
  };

  private confirmDelete(sectionId: string): void {
    if (confirm('Delete this slide?')) this.run(this.session.deleteSlide(sectionId));
  }

  private onDragStart = (event: DragEvent): void => {
    const item = (event.target as HTMLElement).closest<HTMLElement>('.slide-item');
    this.dragId = item?.dataset.sectionId ?? null;
  };

  private onDragOver = (event: DragEvent): void => {
    if (this.dragId) event.preventDefault();
  };

  private onDrop = (event: DragEvent): void => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('.slide-item');
    if (!this.dragId || !target) return;
    const targetId = target.dataset.sectionId ?? '';
    const ids = this.session.slides.map((s) => s.sectionId);
    const from = ids.indexOf(this.dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    this.dragId = null;
    this.run(this.session.reorder(ids));
  };

  private run(promise: Promise<void>): void {
    promise.catch((err: unknown) =>
      this.onError(err instanceof Error ? err.message : 'Action failed'),
    );
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string,
  );
}
