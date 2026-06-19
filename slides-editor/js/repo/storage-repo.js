// Repo for the `slides-images` Supabase Storage bucket.
// Bucket is public-read; uploads are scoped under each deck's deck_id prefix.
//
// Path: `{deck_id}/{base36-timestamp}-{safe-filename}`
import { supabase } from "../supabase.js";
import { resolveStorageSrc, toStorageSrc } from "../storage-src.js";

const BUCKET = "slides-images";

function safeName(name) {
  return (name || "image")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9.\-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "image";
}

export function getPublicUrl(path) {
  return resolveStorageSrc(toStorageSrc(path));
}

export async function uploadImage(deckId, file) {
  if (!file || !file.type?.startsWith("image/")) {
    throw new Error(`Not an image: ${file?.name || "(no file)"}`);
  }
  const ts = Date.now().toString(36);
  const path = `${deckId}/${ts}-${safeName(file.name)}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: false, cacheControl: "3600", contentType: file.type });
  if (error) throw error;
  const storageSrc = toStorageSrc(path);
  return {
    path,
    storageSrc,
    previewUrl: resolveStorageSrc(storageSrc),
    name: file.name,
    size: file.size,
  };
}

export async function listImages(deckId) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(deckId, {
      limit: 500,
      sortBy: { column: "created_at", order: "desc" },
    });
  if (error) throw error;
  return (data || [])
    // .list returns sub-folders too; filter to actual files.
    .filter((o) => o.id || (o.metadata && o.metadata.size != null))
    .map((o) => {
      const path = `${deckId}/${o.name}`;
      const storageSrc = toStorageSrc(path);
      return {
        name: o.name,
        path,
        storageSrc,
        previewUrl: resolveStorageSrc(storageSrc),
        size: o.metadata?.size ?? null,
        createdAt: o.created_at ?? null,
      };
    });
}

export async function deleteImage(path) {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}
