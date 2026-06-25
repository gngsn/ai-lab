import type { Ports } from '@ports/ports';
import { createMemoryDb, type MemoryDb } from './memory-db';
import { MemoryAuth } from './memory-auth';
import { MemoryDeckStore } from './memory-deck-store';
import { MemorySlideStore } from './memory-slide-store';
import { MemoryNotesStore } from './memory-notes-store';
import { MemoryHistoryStore } from './memory-history-store';
import { MemoryBlobStorage } from './memory-blob-storage';
import { MemoryRealtime } from './memory-realtime';
import { MemoryShareRead } from './memory-share-read';
import { MemoryAudioCache } from './memory-audio-cache';
import { DompurifySanitizer } from '@adapters/browser/dompurify-sanitizer';

/** Build a fully in-memory Ports bundle (no backend). The DB is shared across stores. */
export function createMemoryPorts(db: MemoryDb = createMemoryDb()): Ports {
  return {
    auth: new MemoryAuth(),
    deckStore: new MemoryDeckStore(db),
    slideStore: new MemorySlideStore(db),
    notesStore: new MemoryNotesStore(db),
    historyStore: new MemoryHistoryStore(db),
    blobStorage: new MemoryBlobStorage(db),
    realtime: new MemoryRealtime(),
    shareRead: new MemoryShareRead(db),
    audioCache: new MemoryAudioCache(),
    sanitizer: new DompurifySanitizer(),
  };
}
