import type { BlobStoragePort, BlobObject } from '@ports/blob-storage-port';
import type { MemoryDb } from './memory-db';
import { safeFilename } from '@core/text/safe-filename';

const BUCKET = 'slides-images';

export class MemoryBlobStorage implements BlobStoragePort {
  constructor(private readonly db: MemoryDb) {}

  async list(deckId: string, limit = 500): Promise<BlobObject[]> {
    return [...this.db.blobs.values()]
      .filter((o) => o.path.startsWith(`${deckId}/`))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map(({ data: _data, ...meta }) => meta);
  }

  async upload(deckId: string, file: File): Promise<BlobObject> {
    const path = `${deckId}/${Date.now().toString(36)}-${safeFilename(file.name)}`;
    const object = { path, url: URL.createObjectURL(file), updatedAt: new Date().toISOString() };
    this.db.blobs.set(path, { ...object, data: file });
    return object;
  }

  async remove(path: string): Promise<void> {
    this.db.blobs.delete(path);
  }

  resolveUrl(appScheme: string): string {
    const prefix = `supabase://${BUCKET}/`;
    if (!appScheme.startsWith(prefix)) return appScheme;
    const path = appScheme.slice(prefix.length);
    return this.db.blobs.get(path)?.url ?? appScheme;
  }
}
