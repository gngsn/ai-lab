import { z } from 'zod';
import { medalFields } from './validation';
import { Medal, Profile } from './types';
import { blobDataUrl } from './images';
const imageData = z
  .string()
  .max(16 * 1024 * 1024)
  .regex(
    /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/,
    'The backup must contain embedded PNG, JPEG, or WebP photos.',
  );
const backupSchema = z.object({
  version: z.literal(1),
  medals: z
    .array(
      medalFields.extend({
        id: z.string().uuid(),
        image: imageData,
        originalImage: imageData.optional(),
        createdAt: z.string().datetime({ offset: true }),
      }),
    )
    .max(200, 'Restore up to 200 medals at a time.'),
});
export function parseBackup(text: string): Medal[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('This is not a valid JSON backup.');
  }
  const result = backupSchema.safeParse(data);
  if (!result.success)
    throw new Error(`Could not restore this backup: ${result.error.issues[0].message}`);
  // Restoring a backup is always private until the runner explicitly republishes it.
  return result.data.medals.map((medal) => ({ ...medal, visibility: 'private' }));
}
export async function createBackup(medals: Medal[], profile: Profile): Promise<Blob> {
  const embedded: Medal[] = [];
  async function embed(source: string) {
    if (source.startsWith('data:')) return source;
    const response = await fetch(source);
    if (!response.ok)
      throw new Error('Could not read a photo. Refresh your shelf and try the backup again.');
    return blobDataUrl(await response.blob());
  }
  for (const medal of medals) {
    const image = await embed(medal.image);
    const originalImage =
      medal.originalImage && medal.originalImage !== medal.image
        ? await embed(medal.originalImage)
        : image;
    embedded.push({ ...medal, image, originalImage });
  }
  return new Blob([JSON.stringify({ version: 1, profile, medals: embedded }, null, 2)], {
    type: 'application/json',
  });
}
