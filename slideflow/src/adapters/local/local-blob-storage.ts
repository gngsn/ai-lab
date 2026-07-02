import type { BlobStoragePort, BlobObject } from '@ports/blob-storage-port';
import { safeFilename } from '@core/text/safe-filename';

const BUCKET = 'slides-images';

/**
 * Image storage backed by a Dockerized MinIO bucket with an anonymous public
 * policy (dev only). Uploads/lists/deletes are plain S3 HTTP calls — no signing.
 */
export class LocalBlobStorage implements BlobStoragePort {
  /** @param storageUrl e.g. http://localhost:9000 */
  constructor(private readonly storageUrl: string) {}

  async list(deckId: string, limit = 500): Promise<BlobObject[]> {
    const url = `${this.base}/${BUCKET}?list-type=2&prefix=${encodeURIComponent(`${deckId}/`)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`List failed: ${res.status}`);
    const xml = new DOMParser().parseFromString(await res.text(), 'application/xml');
    return [...xml.querySelectorAll('Contents')]
      .map((node) => ({
        path: node.querySelector('Key')?.textContent ?? '',
        updatedAt: node.querySelector('LastModified')?.textContent ?? '',
      }))
      .filter((o) => o.path)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, limit)
      .map((o) => ({ path: o.path, url: this.objectUrl(o.path), updatedAt: o.updatedAt }));
  }

  async upload(deckId: string, file: File): Promise<BlobObject> {
    const path = `${deckId}/${Date.now().toString(36)}-${safeFilename(file.name)}`;
    const res = await fetch(this.objectUrl(path), {
      method: 'PUT',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return { path, url: this.objectUrl(path), updatedAt: new Date().toISOString() };
  }

  async remove(path: string): Promise<void> {
    const res = await fetch(this.objectUrl(path), { method: 'DELETE' });
    if (!res.ok && res.status !== 204) throw new Error(`Delete failed: ${res.status}`);
  }

  resolveUrl(appScheme: string): string {
    const prefix = `supabase://${BUCKET}/`;
    return appScheme.startsWith(prefix)
      ? this.objectUrl(appScheme.slice(prefix.length))
      : appScheme;
  }

  private get base(): string {
    return this.storageUrl.replace(/\/$/, '');
  }

  private objectUrl(path: string): string {
    return `${this.base}/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
  }
}
