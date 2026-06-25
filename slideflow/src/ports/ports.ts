import type { AuthPort } from './auth-port';
import type { DeckStorePort } from './deck-store-port';
import type { SlideStorePort } from './slide-store-port';
import type { NotesStorePort } from './notes-store-port';
import type { HistoryStorePort } from './history-store-port';
import type { BlobStoragePort } from './blob-storage-port';
import type { RealtimePort } from './realtime-port';
import type { ShareReadPort } from './share-read-port';
import type { AudioCachePort } from './audio-cache-port';
import type { SanitizerPort } from './sanitizer-port';

/**
 * The single injectable bundle pages receive from `composition/getPorts()`.
 * Every capability the app needs, behind an interface — no backend leaks past here.
 */
export interface Ports {
  auth: AuthPort;
  deckStore: DeckStorePort;
  slideStore: SlideStorePort;
  notesStore: NotesStorePort;
  historyStore: HistoryStorePort;
  blobStorage: BlobStoragePort;
  realtime: RealtimePort;
  shareRead: ShareReadPort;
  audioCache: AudioCachePort;
  sanitizer: SanitizerPort;
}
