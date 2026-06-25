import type { Slide } from '@core/model/slide';

/** Minimal, sanitized deck data exposed to an anonymous shared viewer (SPEC §6.2, §9.9). */
export interface SharedDeck {
  deckId: string;
  title: string;
  frameHtml: string;
}

/**
 * Public, token-scoped reads for the shared view. Returns data only when the token
 * matches; never exposes notes, history, or owner identity.
 */
export interface ShareReadPort {
  getDeck(deckId: string, token: string): Promise<SharedDeck | null>;
  getSlides(deckId: string, token: string): Promise<Slide[]>;
}
