import type { ShareReadPort, SharedDeck } from '@ports/share-read-port';
import type { Slide } from '@core/model/slide';
import type { SupabaseClient } from './supabase-client';

interface DeckRpcRow {
  deck_id: string;
  title: string;
  frame_html: string;
}
interface SlideRpcRow {
  section_id: string;
  order: number;
  title: string;
  content: string;
}

/** Anonymous, token-scoped reads via the `public_get_*` RPCs (SPEC §6.2). */
export class SupabaseShareRead implements ShareReadPort {
  constructor(private readonly sb: SupabaseClient) {}

  async getDeck(deckId: string, token: string): Promise<SharedDeck | null> {
    const { data, error } = await this.sb.rpc('public_get_deck', {
      p_deck_id: deckId,
      p_token: token,
    });
    if (error) throw new Error(error.message);
    const row = (data as DeckRpcRow[])[0];
    return row ? { deckId: row.deck_id, title: row.title, frameHtml: row.frame_html } : null;
  }

  async getSlides(deckId: string, token: string): Promise<Slide[]> {
    const { data, error } = await this.sb.rpc('public_get_slides', {
      p_deck_id: deckId,
      p_token: token,
    });
    if (error) throw new Error(error.message);
    return (data as SlideRpcRow[]).map((r) => ({
      deckId,
      sectionId: r.section_id,
      order: r.order,
      title: r.title,
      content: r.content,
      updatedAt: '',
    }));
  }
}
