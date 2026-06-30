import type { ShareReadPort, SharedDeck } from '@ports/share-read-port';
import type { Slide } from '@core/model/slide';
import type { RestClient } from './rest-client';

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

/** Anonymous, token-scoped reads via PostgREST `/rpc/public_get_*` (SPEC §6.2). */
export class LocalShareRead implements ShareReadPort {
  constructor(private readonly rest: RestClient) {}

  async getDeck(deckId: string, token: string): Promise<SharedDeck | null> {
    const rows = await this.rest.rpc<DeckRpcRow[]>('public_get_deck', {
      p_deck_id: deckId,
      p_token: token,
    });
    const row = rows[0];
    return row ? { deckId: row.deck_id, title: row.title, frameHtml: row.frame_html } : null;
  }

  async getSlides(deckId: string, token: string): Promise<Slide[]> {
    const rows = await this.rest.rpc<SlideRpcRow[]>('public_get_slides', {
      p_deck_id: deckId,
      p_token: token,
    });
    return rows.map((r) => ({
      deckId,
      sectionId: r.section_id,
      order: r.order,
      title: r.title,
      content: r.content,
      updatedAt: '',
    }));
  }
}
