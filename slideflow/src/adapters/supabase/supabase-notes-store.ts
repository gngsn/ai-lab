import type { NotesStorePort } from '@ports/notes-store-port';
import type { Note } from '@core/model/notes';
import type { SupabaseClient } from './supabase-client';

interface NoteRow {
  deck_id: string;
  section_id: string;
  content: string;
  updated_at: string;
}

const nowIso = () => new Date().toISOString();

export class SupabaseNotesStore implements NotesStorePort {
  constructor(private readonly sb: SupabaseClient) {}

  async listByDeck(deckId: string): Promise<Note[]> {
    const { data, error } = await this.sb.from('notes').select('*').eq('deck_id', deckId);
    if (error) throw new Error(error.message);
    return (data as NoteRow[]).map(toNote);
  }

  async get(deckId: string, sectionId: string): Promise<Note | null> {
    const { data, error } = await this.sb
      .from('notes')
      .select('*')
      .eq('deck_id', deckId)
      .eq('section_id', sectionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? toNote(data as NoteRow) : null;
  }

  async upsert(deckId: string, sectionId: string, content: string): Promise<void> {
    const { error } = await this.sb
      .from('notes')
      .upsert({ deck_id: deckId, section_id: sectionId, content, updated_at: nowIso() });
    if (error) throw new Error(error.message);
  }

  async remove(deckId: string, sectionId: string): Promise<void> {
    const { error } = await this.sb
      .from('notes')
      .delete()
      .eq('deck_id', deckId)
      .eq('section_id', sectionId);
    if (error) throw new Error(error.message);
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
