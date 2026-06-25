import type { Slide, SlideInput } from '@core/model/slide';

/** Slide persistence for one deck. `reorder` maps to the backend's own atomic reorder. */
export interface SlideStorePort {
  /** Slides for a deck, ordered by `order` ascending. */
  listByDeck(deckId: string): Promise<Slide[]>;
  add(deckId: string, slide: SlideInput): Promise<void>;
  updateContent(deckId: string, sectionId: string, content: string): Promise<void>;
  updateTitle(deckId: string, sectionId: string, title: string): Promise<void>;
  remove(deckId: string, sectionId: string): Promise<void>;
  /** Persist a new ordering; `order` becomes the index of each id in the array. */
  reorder(deckId: string, sectionIds: string[]): Promise<void>;
}
