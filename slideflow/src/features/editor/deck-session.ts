import type { Ports } from '@ports/ports';
import type { Deck } from '@core/model/deck';
import type { Slide } from '@core/model/slide';
import type { HistorySource } from '@core/model/history';
import { newSectionId } from '@core/text/section-id';
import { isSlideHiddenContent, setSlideHiddenContent } from '@core/slide/slide-visibility';

const NEW_SLIDE_CONTENT =
  '<section class="slide" data-title="Untitled"><div>' +
  '<h1 data-editable="true">New slide</h1>' +
  '<p data-editable="true">Add your content here.</p></div></section>';

type Listener = () => void;

/**
 * The editor's in-memory model for one deck. Owns slides + notes state and is the
 * single place slide mutations are orchestrated against the ports. UI features
 * render from it and subscribe to changes; they never touch ports for slide ops.
 */
export class DeckSession {
  deck!: Deck;
  slides: Slide[] = [];
  notes = new Map<string, string>();
  currentSectionId = '';

  private readonly changeListeners = new Set<Listener>();

  constructor(
    private readonly ports: Ports,
    readonly deckId: string,
  ) {}

  async load(): Promise<void> {
    const deck = await this.ports.deckStore.get(this.deckId);
    if (!deck) throw new Error('Deck not found or access denied.');
    this.deck = deck;
    this.slides = await this.ports.slideStore.listByDeck(this.deckId);
    for (const note of await this.ports.notesStore.listByDeck(this.deckId)) {
      this.notes.set(note.sectionId, note.content);
    }
    this.currentSectionId = this.slides[0]?.sectionId ?? '';
  }

  onChange(listener: Listener): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  current(): Slide | undefined {
    return this.slides.find((s) => s.sectionId === this.currentSectionId);
  }

  noteOf(sectionId: string): string {
    return this.notes.get(sectionId) ?? '';
  }

  select(sectionId: string): void {
    if (sectionId === this.currentSectionId) return;
    this.currentSectionId = sectionId;
    this.emit();
  }

  async addSlide(): Promise<void> {
    const sectionId = newSectionId();
    const order = this.nextOrder();
    await this.ports.slideStore.add(this.deckId, {
      sectionId,
      order,
      title: 'Untitled',
      content: NEW_SLIDE_CONTENT,
    });
    await this.ports.notesStore.upsert(this.deckId, sectionId, '');
    this.slides.push({
      deckId: this.deckId,
      sectionId,
      order,
      title: 'Untitled',
      content: NEW_SLIDE_CONTENT,
      updatedAt: new Date().toISOString(),
    });
    this.notes.set(sectionId, '');
    this.currentSectionId = sectionId;
    this.emit();
  }

  async duplicateSlide(sourceId: string): Promise<void> {
    const index = this.slides.findIndex((s) => s.sectionId === sourceId);
    const source = this.slides[index];
    if (!source) return;
    const sectionId = newSectionId();
    const copy: Slide = {
      ...source,
      sectionId,
      title: `${source.title} (copy)`,
      order: this.nextOrder(),
      updatedAt: new Date().toISOString(),
    };
    await this.ports.slideStore.add(this.deckId, {
      sectionId,
      order: copy.order,
      title: copy.title,
      content: copy.content,
    });
    const note = this.noteOf(sourceId);
    await this.ports.notesStore.upsert(this.deckId, sectionId, note);
    this.notes.set(sectionId, note);
    this.slides.splice(index + 1, 0, copy);
    this.currentSectionId = sectionId;
    await this.persistOrder();
    this.emit();
  }

  async deleteSlide(sectionId: string): Promise<void> {
    const index = this.slides.findIndex((s) => s.sectionId === sectionId);
    if (index < 0) return;
    await this.ports.slideStore.remove(this.deckId, sectionId);
    this.slides.splice(index, 1);
    this.notes.delete(sectionId);
    if (this.currentSectionId === sectionId) {
      this.currentSectionId = (this.slides[index] ?? this.slides[index - 1])?.sectionId ?? '';
    }
    this.emit();
  }

  async toggleHidden(sectionId: string): Promise<void> {
    const slide = this.slides.find((s) => s.sectionId === sectionId);
    if (!slide) return;
    const content = setSlideHiddenContent(slide.content, !isSlideHiddenContent(slide.content));
    slide.content = content;
    await this.ports.slideStore.updateContent(this.deckId, sectionId, content);
    this.emit();
  }

  /** Optimistic reorder with rollback on persistence failure. */
  async reorder(orderedIds: string[]): Promise<void> {
    const previous = [...this.slides];
    this.slides = orderedIds
      .map((id) => this.slides.find((s) => s.sectionId === id))
      .filter((s): s is Slide => Boolean(s));
    this.slides.forEach((s, i) => (s.order = i));
    this.emit();
    try {
      await this.ports.slideStore.reorder(this.deckId, orderedIds);
    } catch (err) {
      this.slides = previous;
      this.emit();
      throw err;
    }
  }

  async saveContent(sectionId: string, content: string): Promise<void> {
    const slide = this.slides.find((s) => s.sectionId === sectionId);
    if (slide) slide.content = content;
    await this.ports.slideStore.updateContent(this.deckId, sectionId, content);
    this.recordAuto('slide', sectionId, content);
  }

  async saveFrame(frameHtml: string): Promise<void> {
    this.deck.frameHtml = frameHtml;
    await this.ports.deckStore.updateFrame(this.deckId, frameHtml);
    this.recordAuto('frame', 'frame', frameHtml);
  }

  listHistory(sectionId?: string) {
    return this.ports.historyStore.list(this.deckId, sectionId);
  }

  /** Restore a history entry back to its surface (creates a fresh auto snapshot). */
  async restore(source: HistorySource, sectionId: string, content: string): Promise<void> {
    if (source === 'frame') await this.saveFrame(content);
    else if (source === 'notes') await this.saveNote(sectionId, content);
    else await this.saveContent(sectionId, content);
  }

  /** Manual snapshot of every slide, note, and the frame under one message (SPEC §11). */
  async saveVersion(message: string): Promise<void> {
    const entries = [
      ...this.slides.map((s) => entry('slide', s.sectionId, s.content)),
      ...[...this.notes].map(([sectionId, content]) => entry('notes', sectionId, content)),
      entry('frame', 'frame', this.deck.frameHtml),
    ];
    await this.ports.historyStore.appendManualBatch(
      entries.map((e) => ({ deckId: this.deckId, kind: 'manual' as const, message, ...e })),
    );
  }

  async saveTitle(sectionId: string, title: string): Promise<void> {
    const slide = this.slides.find((s) => s.sectionId === sectionId);
    if (slide) slide.title = title;
    await this.ports.slideStore.updateTitle(this.deckId, sectionId, title);
    this.emit();
  }

  async saveNote(sectionId: string, content: string): Promise<void> {
    this.notes.set(sectionId, content);
    await this.ports.notesStore.upsert(this.deckId, sectionId, content);
    this.recordAuto('notes', sectionId, content);
  }

  /** Best-effort deduplicated auto snapshot; never blocks or fails a save. */
  private recordAuto(source: HistorySource, sectionId: string, content: string): void {
    void this.ports.historyStore
      .appendAuto({ deckId: this.deckId, sectionId, content, kind: 'auto', message: null, source })
      .catch(() => {});
  }

  async saveDeckTitle(title: string): Promise<void> {
    this.deck.title = title;
    await this.ports.deckStore.updateTitle(this.deckId, title);
  }

  async setShareToken(token: string | null): Promise<void> {
    this.deck.shareToken = token;
    await this.ports.deckStore.setShareToken(this.deckId, token);
  }

  private nextOrder(): number {
    return this.slides.reduce((max, s) => Math.max(max, s.order), -1) + 1;
  }

  private persistOrder(): Promise<void> {
    return this.ports.slideStore.reorder(
      this.deckId,
      this.slides.map((s) => s.sectionId),
    );
  }

  private emit(): void {
    for (const listener of this.changeListeners) listener();
  }
}

function entry(source: HistorySource, sectionId: string, content: string) {
  return { source, sectionId, content };
}
