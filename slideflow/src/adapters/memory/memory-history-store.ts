import type { HistoryStorePort } from '@ports/history-store-port';
import type { HistoryEntry, HistoryInput } from '@core/model/history';
import type { MemoryDb } from './memory-db';

export class MemoryHistoryStore implements HistoryStorePort {
  constructor(private readonly db: MemoryDb) {}

  async list(deckId: string, sectionId?: string): Promise<HistoryEntry[]> {
    return this.db.history
      .filter((h) => h.deckId === deckId && (sectionId === undefined || h.sectionId === sectionId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);
  }

  async appendAuto(entry: HistoryInput): Promise<void> {
    if (this.isDuplicateOfLatest(entry)) return;
    this.push(entry, new Date().toISOString());
  }

  async appendManualBatch(entries: HistoryInput[]): Promise<void> {
    const createdAt = new Date().toISOString();
    for (const entry of entries) this.push(entry, createdAt);
  }

  private isDuplicateOfLatest(entry: HistoryInput): boolean {
    const latest = this.db.history
      .filter(
        (h) =>
          h.deckId === entry.deckId &&
          h.sectionId === entry.sectionId &&
          h.source === entry.source,
      )
      .at(-1);
    return latest?.content === entry.content;
  }

  private push(entry: HistoryInput, createdAt: string): void {
    this.db.history.push({
      id: ++this.db.historySeq,
      deckId: entry.deckId,
      sectionId: entry.sectionId,
      content: entry.content,
      kind: entry.kind,
      message: entry.message,
      createdAt,
      source: entry.source,
    });
  }
}
