import type { HistoryEntry, HistoryInput } from '@core/model/history';

/** Append-only history across slide/notes/frame surfaces (SPEC §5.5, §11). */
export interface HistoryStorePort {
  /** Merged history for a deck, newest first; optionally filtered to one section. */
  list(deckId: string, sectionId?: string): Promise<HistoryEntry[]>;
  /** Append one auto row, skipping it if the latest row for the same key is identical. */
  appendAuto(entry: HistoryInput): Promise<void>;
  /** Insert a batch of manual rows sharing one createdAt + message. */
  appendManualBatch(entries: HistoryInput[]): Promise<void>;
}
