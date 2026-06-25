/** One stored image object under a deck's namespace. */
export interface BlobObject {
  /** Object path, always beginning with `{deckId}/` (SPEC §8). */
  path: string;
  /** Public URL for direct use in slide HTML. */
  url: string;
  updatedAt: string;
}

/** Image storage scoped to a deck. Writes require an owner session (enforced by the backend). */
export interface BlobStoragePort {
  /** Up to `limit` objects under `{deckId}/`, newest first. */
  list(deckId: string, limit?: number): Promise<BlobObject[]>;
  upload(deckId: string, file: File): Promise<BlobObject>;
  remove(path: string): Promise<void>;
  /** Resolve an app-scheme `supabase://slides-images/{path}` to a public URL. */
  resolveUrl(appScheme: string): string;
}
