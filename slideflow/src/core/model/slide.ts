/** One slide: exactly one `<section>...</section>` string, ordered within a deck (SPEC §5.3). */
export interface Slide {
  deckId: string;
  sectionId: string;
  /** 0-based render order, ascending. */
  order: number;
  title: string;
  content: string;
  updatedAt: string;
}

/** Fields needed to append a new slide. */
export interface SlideInput {
  sectionId: string;
  order: number;
  title: string;
  content: string;
}
