import type { Note } from '@core/model/notes';

/** Speaker-notes persistence. Missing notes are treated as empty by callers (SPEC §5.4). */
export interface NotesStorePort {
  listByDeck(deckId: string): Promise<Note[]>;
  get(deckId: string, sectionId: string): Promise<Note | null>;
  upsert(deckId: string, sectionId: string, content: string): Promise<void>;
  remove(deckId: string, sectionId: string): Promise<void>;
}
