import type { NotesStorePort } from '@ports/notes-store-port';
import type { Note } from '@core/model/notes';
import type { RestClient } from './rest-client';

interface NoteRow {
  deck_id: string;
  section_id: string;
  content: string;
  updated_at: string;
}

const nowIso = () => new Date().toISOString();

export class LocalNotesStore implements NotesStorePort {
  constructor(private readonly rest: RestClient) {}

  async listByDeck(deckId: string): Promise<Note[]> {
    const rows = await this.rest.get<NoteRow[]>('/notes', `deck_id=eq.${deckId}`);
    return rows.map(toNote);
  }

  async get(deckId: string, sectionId: string): Promise<Note | null> {
    const rows = await this.rest.get<NoteRow[]>(
      '/notes',
      `deck_id=eq.${deckId}&section_id=eq.${sectionId}&limit=1`,
    );
    return rows[0] ? toNote(rows[0]) : null;
  }

  async upsert(deckId: string, sectionId: string, content: string): Promise<void> {
    await this.rest.post(
      '/notes',
      { deck_id: deckId, section_id: sectionId, content, updated_at: nowIso() },
      'resolution=merge-duplicates,return=minimal',
    );
  }

  async remove(deckId: string, sectionId: string): Promise<void> {
    await this.rest.delete('/notes', `deck_id=eq.${deckId}&section_id=eq.${sectionId}`);
  }
}

function toNote(row: NoteRow): Note {
  return {
    deckId: row.deck_id,
    sectionId: row.section_id,
    content: row.content,
    updatedAt: row.updated_at,
  };
}
