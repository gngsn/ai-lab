import type { HistoryStorePort } from '@ports/history-store-port';
import type { HistoryEntry, HistoryInput, HistorySource } from '@core/model/history';
import type { RestClient } from './rest-client';

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

export class LocalHistoryStore implements HistoryStorePort {
  constructor(private readonly rest: RestClient) {}

  async list(deckId: string, sectionId?: string): Promise<HistoryEntry[]> {
    const merged: HistoryEntry[] = [];
    for (const source of SOURCES) {
      let query = `deck_id=eq.${deckId}`;
      if (sectionId) query += `&section_id=eq.${sectionId}`;
      query += '&order=created_at.desc';
      const rows = await this.rest.get<HistoryRow[]>(`/${TABLE[source]}`, query);
      for (const row of rows) merged.push(toEntry(row, source));
    }
    return merged.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  }

  async appendAuto(entry: HistoryInput): Promise<void> {
    const table = TABLE[entry.source];
    const latest = await this.rest.get<HistoryRow[]>(
      `/${table}`,
      `deck_id=eq.${entry.deckId}&section_id=eq.${entry.sectionId}&order=created_at.desc&limit=1`,
    );
    if (latest[0]?.content === entry.content) return;
    await this.rest.post(`/${table}`, toRow(entry), 'return=minimal');
  }

  async appendManualBatch(entries: HistoryInput[]): Promise<void> {
    const createdAt = new Date().toISOString();
    for (const source of SOURCES) {
      const rows = entries.filter((e) => e.source === source).map((e) => toRow(e, createdAt));
      if (rows.length) await this.rest.post(`/${TABLE[source]}`, rows, 'return=minimal');
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
