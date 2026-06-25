import type { SlideStorePort } from '@ports/slide-store-port';
import type { Slide, SlideInput } from '@core/model/slide';
import type { MemoryDb } from './memory-db';

export class MemorySlideStore implements SlideStorePort {
  constructor(private readonly db: MemoryDb) {}

  async listByDeck(deckId: string): Promise<Slide[]> {
    return [...this.deckSlides(deckId).values()].sort((a, b) => a.order - b.order);
  }

  async add(deckId: string, input: SlideInput): Promise<void> {
    this.deckSlides(deckId).set(input.sectionId, {
      deckId,
      sectionId: input.sectionId,
      order: input.order,
      title: input.title,
      content: input.content,
      updatedAt: new Date().toISOString(),
    });
  }

  async updateContent(deckId: string, sectionId: string, content: string): Promise<void> {
    this.patch(deckId, sectionId, { content });
  }

  async updateTitle(deckId: string, sectionId: string, title: string): Promise<void> {
    this.patch(deckId, sectionId, { title });
  }

  async remove(deckId: string, sectionId: string): Promise<void> {
    this.deckSlides(deckId).delete(sectionId);
  }

  async reorder(deckId: string, sectionIds: string[]): Promise<void> {
    const slides = this.deckSlides(deckId);
    sectionIds.forEach((sectionId, index) => {
      const slide = slides.get(sectionId);
      if (slide) slides.set(sectionId, { ...slide, order: index });
    });
  }

  private deckSlides(deckId: string): Map<string, Slide> {
    let slides = this.db.slides.get(deckId);
    if (!slides) {
      slides = new Map();
      this.db.slides.set(deckId, slides);
    }
    return slides;
  }

  private patch(deckId: string, sectionId: string, fields: Partial<Slide>): void {
    const slides = this.deckSlides(deckId);
    const slide = slides.get(sectionId);
    if (!slide) throw new Error(`slide not found: ${deckId}/${sectionId}`);
    slides.set(sectionId, { ...slide, ...fields, updatedAt: new Date().toISOString() });
  }
}
