import type { SlideStorePort } from '@ports/slide-store-port';
import type { Slide, SlideInput } from '@core/model/slide';
import type { RestClient } from './rest-client';

/** PostgREST row shape for `slides`. The column literally named "order" maps to `order`. */
interface SlideRow {
  deck_id: string;
  section_id: string;
  order: number;
  title: string;
  content: string;
  updated_at: string;
}

const nowIso = () => new Date().toISOString();

export class LocalSlideStore implements SlideStorePort {
  constructor(private readonly rest: RestClient) {}

  async listByDeck(deckId: string): Promise<Slide[]> {
    // `order=order.asc`: the first `order` is the PostgREST keyword, the second the column.
    const rows = await this.rest.get<SlideRow[]>('/slides', `deck_id=eq.${deckId}&order=order.asc`);
    return rows.map(toSlide);
  }

  async add(deckId: string, slide: SlideInput): Promise<void> {
    await this.rest.post(
      '/slides',
      {
        deck_id: deckId,
        section_id: slide.sectionId,
        order: slide.order,
        title: slide.title,
        content: slide.content,
      },
      'return=minimal',
    );
  }

  async updateContent(deckId: string, sectionId: string, content: string): Promise<void> {
    await this.patch(deckId, sectionId, { content });
  }

  async updateTitle(deckId: string, sectionId: string, title: string): Promise<void> {
    await this.patch(deckId, sectionId, { title });
  }

  async remove(deckId: string, sectionId: string): Promise<void> {
    await this.rest.delete('/slides', `deck_id=eq.${deckId}&section_id=eq.${sectionId}`);
  }

  async reorder(deckId: string, sectionIds: string[]): Promise<void> {
    await this.rest.rpc('reorder_slides', { p_deck_id: deckId, p_section_ids: sectionIds });
  }

  private patch(deckId: string, sectionId: string, fields: Partial<SlideRow>): Promise<unknown> {
    return this.rest.patch('/slides', `deck_id=eq.${deckId}&section_id=eq.${sectionId}`, {
      ...fields,
      updated_at: nowIso(),
    });
  }
}

function toSlide(row: SlideRow): Slide {
  return {
    deckId: row.deck_id,
    sectionId: row.section_id,
    order: row.order,
    title: row.title,
    content: row.content,
    updatedAt: row.updated_at,
  };
}
