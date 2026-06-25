import type { ShareReadPort, SharedDeck } from '@ports/share-read-port';
import type { Slide } from '@core/model/slide';
import type { MemoryDb } from './memory-db';

/** Validates the token against the deck, then exposes only sanitized public fields. */
export class MemoryShareRead implements ShareReadPort {
  constructor(private readonly db: MemoryDb) {}

  async getDeck(deckId: string, token: string): Promise<SharedDeck | null> {
    const deck = this.authorized(deckId, token);
    if (!deck) return null;
    return { deckId: deck.deckId, title: deck.title, frameHtml: deck.frameHtml };
  }

  async getSlides(deckId: string, token: string): Promise<Slide[]> {
    if (!this.authorized(deckId, token)) return [];
    return [...(this.db.slides.get(deckId)?.values() ?? [])].sort((a, b) => a.order - b.order);
  }

  private authorized(deckId: string, token: string) {
    const deck = this.db.decks.get(deckId);
    return deck && deck.shareToken && deck.shareToken === token ? deck : null;
  }
}
