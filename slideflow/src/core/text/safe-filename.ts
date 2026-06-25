/**
 * Normalize an upload filename for storage paths (SPEC §8):
 * lowercase, NFKD-normalized, non `[a-z0-9._-]` replaced with `-`, max 80 chars.
 */
export function safeFilename(name: string): string {
  const normalized = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (normalized || 'file').slice(0, 80);
}
