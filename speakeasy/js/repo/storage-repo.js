// Repo for the `slides-images` Supabase Storage bucket.
// Bucket is public-read; uploads are scoped under each deck's deck_id prefix.
//
// Path: `{deck_id}/{base36-timestamp}-{safe-filename}`
import { resolveStorageSrc, toStorageSrc } from "../storage-src.js";
import { supabase } from "../supabase.js";

const BUCKET = "slides-images";

function safeName(name) {
  return (
    (name || "image")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9.\-_]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "image"
  );
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
    .upload(path, file, {
      upsert: false,
      cacheControl: "3600",
      contentType: file.type,
    });
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

const MEDIA_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  m4a: "audio/mp4",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
};

/**
 * Store a file copied from an imported deck's source (e.g. its GitHub repo)
 * under `{deck_id}/imported/{sourcePath}`, overwriting a previous import.
 * Returns the public URL — a plain https URL rather than supabase://, so it
 * renders in every view without resolving.
 */
export async function uploadImportedAsset(deckId, sourcePath, blob) {
  const path = `${deckId}/imported/${sourcePath.replace(/^\/+/, "")}`;
  const ext = sourcePath.split(".").pop()?.toLowerCase() || "";
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    upsert: true,
    cacheControl: "3600",
    contentType: MEDIA_TYPES[ext] || blob.type || "application/octet-stream",
  });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function listImages(deckId) {
  const { data, error } = await supabase.storage.from(BUCKET).list(deckId, {
    limit: 500,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (error) throw error;
  return (
    (data || [])
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
      })
  );
}

export async function deleteImage(path) {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}
