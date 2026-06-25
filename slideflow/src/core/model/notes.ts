/** Speaker notes for one slide, matched by `sectionId`. Content is Markdown (SPEC §5.4). */
export interface Note {
  deckId: string;
  sectionId: string;
  content: string;
  updatedAt: string;
}
