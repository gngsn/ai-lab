import type { HistoryStorePort } from '@ports/history-store-port';
import type { HistoryEntry, HistoryInput, HistorySource } from '@core/model/history';
import type { SupabaseClient } from './supabase-client';

interface HistoryRow {
  id: number;
  deck_id: string;
  section_id: string;
  content: string;
  kind: HistoryEntry['kind'];
  message: string | null;
  created_at: string;
}

const TABLE: Record<HistorySource, string> = {
  slide: 'slide_history',
  notes: 'notes_history',
  frame: 'frame_history',
};
const SOURCES: HistorySource[] = ['slide', 'notes', 'frame'];

export class SupabaseHistoryStore implements HistoryStorePort {
  constructor(private readonly sb: SupabaseClient) {}

  async list(deckId: string, sectionId?: string): Promise<HistoryEntry[]> {
    const merged: HistoryEntry[] = [];
    for (const source of SOURCES) {
      let query = this.sb.from(TABLE[source]).select('*').eq('deck_id', deckId);
      if (sectionId) query = query.eq('section_id', sectionId);
      const { data, error } = await query.order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      for (const row of data as HistoryRow[]) merged.push(toEntry(row, source));
    }
    return merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  }

  async appendAuto(entry: HistoryInput): Promise<void> {
    const table = TABLE[entry.source];
    const { data } = await this.sb
      .from(table)
      .select('content')
      .eq('deck_id', entry.deckId)
      .eq('section_id', entry.sectionId)
      .order('created_at', { ascending: false })
      .limit(1);
    if ((data as { content: string }[] | null)?.[0]?.content === entry.content) return;
    const { error } = await this.sb.from(table).insert(toRow(entry));
    if (error) throw new Error(error.message);
  }

  async appendManualBatch(entries: HistoryInput[]): Promise<void> {
    const createdAt = new Date().toISOString();
    for (const source of SOURCES) {
      const rows = entries.filter((e) => e.source === source).map((e) => toRow(e, createdAt));
      if (rows.length) {
        const { error } = await this.sb.from(TABLE[source]).insert(rows);
        if (error) throw new Error(error.message);
      }
    }
  }
}

function toEntry(row: HistoryRow, source: HistorySource): HistoryEntry {
  return {
    id: row.id,
    deckId: row.deck_id,
    sectionId: row.section_id,
    content: row.content,
    kind: row.kind,
    message: row.message,
    createdAt: row.created_at,
    source,
  };
}

function toRow(entry: HistoryInput, createdAt?: string) {
  return {
    deck_id: entry.deckId,
    section_id: entry.sectionId,
    content: entry.content,
    kind: entry.kind,
    message: entry.message,
    ...(createdAt ? { created_at: createdAt } : {}),
  };
}
