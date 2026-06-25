import type { AudioCachePort, CachedAudio } from '@ports/audio-cache-port';

/** In-memory audio cache for dev/tests; the real browser adapter uses IndexedDB. */
export class MemoryAudioCache implements AudioCachePort {
  private readonly store = new Map<string, CachedAudio>();

  async getAudio(key: string): Promise<CachedAudio | null> {
    return this.store.get(key) ?? null;
  }

  async putAudio(key: string, blob: Blob): Promise<void> {
    this.store.set(key, { key, blob, createdAt: new Date().toISOString() });
  }

  async clear(): Promise<void> {
    this.store.clear();
  }
}
