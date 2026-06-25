import type { NotesStorePort } from '@ports/notes-store-port';
import type { Note } from '@core/model/notes';
import type { MemoryDb } from './memory-db';

export class MemoryNotesStore implements NotesStorePort {
  constructor(private readonly db: MemoryDb) {}

  async listByDeck(deckId: string): Promise<Note[]> {
    return [...this.deckNotes(deckId).values()];
  }

  async get(deckId: string, sectionId: string): Promise<Note | null> {
    return this.deckNotes(deckId).get(sectionId) ?? null;
  }

  async upsert(deckId: string, sectionId: string, content: string): Promise<void> {
    this.deckNotes(deckId).set(sectionId, {
      deckId,
      sectionId,
      content,
      updatedAt: new Date().toISOString(),
    });
  }

  async remove(deckId: string, sectionId: string): Promise<void> {
    this.deckNotes(deckId).delete(sectionId);
  }

  private deckNotes(deckId: string): Map<string, Note> {
    let notes = this.db.notes.get(deckId);
    if (!notes) {
      notes = new Map();
      this.db.notes.set(deckId, notes);
    }
    return notes;
  }
}
