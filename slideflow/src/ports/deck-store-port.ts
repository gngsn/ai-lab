import type { Deck, DeckInput } from '@core/model/deck';

/** Owner-scoped deck persistence. Authorization is enforced by the adapter/backend (RLS). */
export interface DeckStorePort {
  /** Decks owned by the user, newest-updated first. */
  listByOwner(ownerId: string): Promise<Deck[]>;
  get(deckId: string): Promise<Deck | null>;
  /** Create or replace a deck owned by `ownerId`. */
  upsert(ownerId: string, ownerEmail: string | null, deck: DeckInput): Promise<void>;
  updateTitle(deckId: string, title: string): Promise<void>;
  updateFrame(deckId: string, frameHtml: string): Promise<void>;
  setShareToken(deckId: string, token: string | null): Promise<void>;
  remove(deckId: string): Promise<void>;
}
