import type { DeckStorePort } from '@ports/deck-store-port';
import type { Deck, DeckInput } from '@core/model/deck';
import type { MemoryDb } from './memory-db';

export class MemoryDeckStore implements DeckStorePort {
  constructor(private readonly db: MemoryDb) {}

  async listByOwner(ownerId: string): Promise<Deck[]> {
    return [...this.db.decks.values()]
      .filter((d) => d.ownerId === ownerId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(deckId: string): Promise<Deck | null> {
    return this.db.decks.get(deckId) ?? null;
  }

  async upsert(ownerId: string, ownerEmail: string | null, input: DeckInput): Promise<void> {
    const now = new Date().toISOString();
    const existing = this.db.decks.get(input.deckId);
    this.db.decks.set(input.deckId, {
      deckId: input.deckId,
      ownerId,
      ownerEmail,
      title: input.title,
      frameHtml: input.frameHtml,
      shareToken: existing?.shareToken ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async updateTitle(deckId: string, title: string): Promise<void> {
    this.patch(deckId, { title });
  }

  async updateFrame(deckId: string, frameHtml: string): Promise<void> {
    this.patch(deckId, { frameHtml });
  }

  async setShareToken(deckId: string, token: string | null): Promise<void> {
    this.patch(deckId, { shareToken: token });
  }

  async remove(deckId: string): Promise<void> {
    this.db.decks.delete(deckId);
    this.db.slides.delete(deckId);
    this.db.notes.delete(deckId);
  }

  private patch(deckId: string, fields: Partial<Deck>): void {
    const deck = this.db.decks.get(deckId);
    if (!deck) throw new Error(`deck not found: ${deckId}`);
    this.db.decks.set(deckId, { ...deck, ...fields, updatedAt: new Date().toISOString() });
  }
}
