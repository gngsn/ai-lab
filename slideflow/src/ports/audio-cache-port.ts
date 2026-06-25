/** Cached TTS audio keyed by section + engine + speed (SPEC §10.7). */
export interface CachedAudio {
  key: string;
  blob: Blob;
  createdAt: string;
}

/** Browser-local cache for the pronunciation trainer; backend-agnostic (IndexedDB adapter). */
export interface AudioCachePort {
  getAudio(key: string): Promise<CachedAudio | null>;
  putAudio(key: string, blob: Blob): Promise<void>;
  clear(): Promise<void>;
}
