import type { Deck } from '@core/model/deck';
import type { Slide } from '@core/model/slide';
import type { Note } from '@core/model/notes';
import type { HistoryEntry } from '@core/model/history';
import type { BlobObject } from '@ports/blob-storage-port';

/** A single in-process store shared by all memory adapters (dev + tests). */
export interface MemoryDb {
  decks: Map<string, Deck>;
  /** deckId -> (sectionId -> slide) */
  slides: Map<string, Map<string, Slide>>;
  /** deckId -> (sectionId -> note) */
  notes: Map<string, Map<string, Note>>;
  history: HistoryEntry[];
  historySeq: number;
  /** path -> object + raw blob */
  blobs: Map<string, BlobObject & { data: Blob }>;
}

export function createMemoryDb(): MemoryDb {
  return {
    decks: new Map(),
    slides: new Map(),
    notes: new Map(),
    history: [],
    historySeq: 0,
    blobs: new Map(),
  };
}
