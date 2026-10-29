// The `slides-audio` Storage bucket (per-slide TTS audio).
// Bucket is public-read; one object per slide at `{deck_id}/{section_id}`.
// Re-uploading overwrites (upsert) so each slide keeps a single latest take.
import { supabase } from "./client";

const BUCKET = "slides-audio";

export function getPublicUrl(path: string) {
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// Upload (overwrite) the slide's audio. Returns { path, url }.
export async function uploadSlideAudio(deckId: string, sectionId: string, blob: Blob) {
  const path = `${deckId}/${sectionId}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    upsert: true,
    cacheControl: "3600",
    contentType: blob.type || "audio/mpeg",
  });
  if (error) throw error;
  return { path, url: getPublicUrl(path) };
}

// Return { path, url, updatedAt } for the slide's stored audio, or null.
export async function getSlideAudio(deckId: string, sectionId: string) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(deckId, { limit: 100, search: sectionId });
  if (error) throw error;
  const match = (data || []).find((o) => o.name === sectionId);
  if (!match) return null;
  const path = `${deckId}/${sectionId}`;
  return {
    path,
    url: getPublicUrl(path),
    updatedAt: match.updated_at || match.created_at || null,
  };
}
