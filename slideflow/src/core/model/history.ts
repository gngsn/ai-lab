/** Auto snapshots are best-effort and deduplicated; manual snapshots are user-triggered batches (SPEC §5.5). */
export type HistoryKind = 'auto' | 'manual';

/** Which editable surface a history row belongs to. */
export type HistorySource = 'slide' | 'notes' | 'frame';

export interface HistoryEntry {
  id: number;
  deckId: string;
  /** Defaults to 'frame' for frame history. */
  sectionId: string;
  content: string;
  kind: HistoryKind;
  message: string | null;
  createdAt: string;
  source: HistorySource;
}

/** Fields needed to append a snapshot (id/createdAt are assigned by the store). */
export interface HistoryInput {
  deckId: string;
  sectionId: string;
  content: string;
  kind: HistoryKind;
  message: string | null;
  source: HistorySource;
}
