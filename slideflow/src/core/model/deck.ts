/** A deck is the stable URL + storage namespace for a presentation (SPEC §5.2). */
export interface Deck {
  deckId: string;
  ownerId: string;
  ownerEmail: string | null;
  title: string;
  /** Whole HTML shell; slides are injected at the `<!-- slides -->` marker. */
  frameHtml: string;
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields needed to create or replace a deck the current user owns. */
export interface DeckInput {
  deckId: string;
  title: string;
  frameHtml: string;
}
