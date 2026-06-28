import type { SlideStorePort } from '@ports/slide-store-port';
import type { Slide, SlideInput } from '@core/model/slide';
import type { SupabaseClient } from './supabase-client';

interface SlideRow {
  deck_id: string;
  section_id: string;
  order: number;
  title: string;
  content: string;
  updated_at: string;
}

const nowIso = () => new Date().toISOString();

export class SupabaseSlideStore implements SlideStorePort {
  constructor(private readonly sb: SupabaseClient) {}

  async listByDeck(deckId: string): Promise<Slide[]> {
    const { data, error } = await this.sb
      .from('slides')
      .select('*')
      .eq('deck_id', deckId)
      .order('order', { ascending: true });
    if (error) throw new Error(error.message);
    return (data as SlideRow[]).map(toSlide);
  }

  async add(deckId: string, slide: SlideInput): Promise<void> {
    const { error } = await this.sb.from('slides').insert({
      deck_id: deckId,
      section_id: slide.sectionId,
      order: slide.order,
      title: slide.title,
      content: slide.content,
    });
    if (error) throw new Error(error.message);
  }

  async updateContent(deckId: string, sectionId: string, content: string): Promise<void> {
    await this.patch(deckId, sectionId, { content });
  }

  async updateTitle(deckId: string, sectionId: string, title: string): Promise<void> {
    await this.patch(deckId, sectionId, { title });
  }

  async remove(deckId: string, sectionId: string): Promise<void> {
    const { error } = await this.sb
      .from('slides')
      .delete()
      .eq('deck_id', deckId)
      .eq('section_id', sectionId);
    if (error) throw new Error(error.message);
  }

  async reorder(deckId: string, sectionIds: string[]): Promise<void> {
    const { error } = await this.sb.rpc('reorder_slides', {
      p_deck_id: deckId,
      p_section_ids: sectionIds,
    });
    if (error) throw new Error(error.message);
  }

  private async patch(deckId: string, sectionId: string, fields: Partial<SlideRow>): Promise<void> {
    const { error } = await this.sb
      .from('slides')
      .update({ ...fields, updated_at: nowIso() })
      .eq('deck_id', deckId)
      .eq('section_id', sectionId);
    if (error) throw new Error(error.message);
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
