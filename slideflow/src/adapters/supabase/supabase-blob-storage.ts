import type { BlobStoragePort, BlobObject } from '@ports/blob-storage-port';
import type { SupabaseClient } from './supabase-client';
import { safeFilename } from '@core/text/safe-filename';

const BUCKET = 'slides-images';

/** Image storage backed by the Supabase `slides-images` bucket (SPEC §8). */
export class SupabaseBlobStorage implements BlobStoragePort {
  constructor(private readonly sb: SupabaseClient) {}

  async list(deckId: string, limit = 500): Promise<BlobObject[]> {
    const { data, error } = await this.sb.storage.from(BUCKET).list(deckId, {
      limit,
      sortBy: { column: 'created_at', order: 'desc' },
    });
    if (error) throw new Error(error.message);
    return (data ?? []).map((file) => {
      const path = `${deckId}/${file.name}`;
      return { path, url: this.publicUrl(path), updatedAt: file.updated_at ?? '' };
    });
  }

  async upload(deckId: string, file: File): Promise<BlobObject> {
    const path = `${deckId}/${Date.now().toString(36)}-${safeFilename(file.name)}`;
    const { error } = await this.sb.storage.from(BUCKET).upload(path, file);
    if (error) throw new Error(error.message);
    return { path, url: this.publicUrl(path), updatedAt: new Date().toISOString() };
  }

  async remove(path: string): Promise<void> {
    const { error } = await this.sb.storage.from(BUCKET).remove([path]);
    if (error) throw new Error(error.message);
  }

  resolveUrl(appScheme: string): string {
    const prefix = `supabase://${BUCKET}/`;
    return appScheme.startsWith(prefix)
      ? this.publicUrl(appScheme.slice(prefix.length))
      : appScheme;
  }

  private publicUrl(path: string): string {
    return this.sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }
}
