// Repo for the deck asset library — the `slides-images` Supabase Storage
// bucket (the name predates non-image assets). The bucket is public-read and
// accepts any file type; uploads are scoped under each deck's deck_id prefix.
//
// The library is global: every deck can use every asset.
//   _library/{base36-timestamp}-{safe-filename}   new uploads (shared)
//   {deck_id}/{base36-timestamp}-{safe-filename}  uploads from before the
//                                                 library went global
//   {deck_id}/imported/…                          files copied by HTML import
// Assets are referenced by their public https URL, so they render in every
// view (editor, present, shared view, exports) without any resolving.
import { supabase } from "../supabase.js";

const BUCKET = "slides-images";
// Shared upload folder. The leading "_" can't come out of slugify(), so it
// never collides with a deck ID.
const LIBRARY = "_library";

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

const extOf = (name) => String(name || "").split(".").pop()?.toLowerCase() || "";
const publicUrl = (path) =>
  supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;

/** "image" | "video" | "audio" | "file", from a MIME type or file name. */
export function assetKind(typeOrName) {
  const v = String(typeOrName || "").toLowerCase();
  const type = v.includes("/") ? v : MEDIA_TYPES[extOf(v)] || "";
  const major = type.split("/")[0];
  return ["image", "video", "audio"].includes(major) ? major : "file";
}

/** Upload any file to the shared asset library. */
export async function uploadAsset(file) {
  if (!file) throw new Error("No file selected");
  const ts = Date.now().toString(36);
  const path = `${LIBRARY}/${ts}-${safeName(file.name)}`;
  const contentType =
    file.type || MEDIA_TYPES[extOf(file.name)] || "application/octet-stream";
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    cacheControl: "3600",
    contentType,
  });
  if (error) throw error;
  return {
    path,
    url: publicUrl(path),
    name: file.name,
    size: file.size,
    kind: assetKind(contentType),
  };
}

/**
 * Store a file copied from an imported deck's source (e.g. its GitHub repo)
 * under `{deck_id}/imported/{sourcePath}`, overwriting a previous import.
 * Returns the public URL — a plain https URL rather than supabase://, so it
 * renders in every view without resolving.
 */
export async function uploadImportedAsset(deckId, sourcePath, blob) {
  const path = `${deckId}/imported/${sourcePath.replace(/^\/+/, "")}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    upsert: true,
    cacheControl: "3600",
    contentType:
      MEDIA_TYPES[extOf(sourcePath)] || blob.type || "application/octet-stream",
  });
  if (error) throw error;
  return publicUrl(path);
}

async function listFolder(folder) {
  const { data, error } = await supabase.storage.from(BUCKET).list(folder, {
    limit: 1000,
    sortBy: { column: "created_at", order: "desc" },
  });
  if (error) throw error;
  return (
    (data || [])
      // .list returns sub-folders too (e.g. imported/); keep only files.
      .filter((o) => o.id || (o.metadata && o.metadata.size != null))
      .map((o) => {
        const path = `${folder}/${o.name}`;
        return {
          name: o.name.replace(/^[0-9a-z]+-/, ""), // drop the upload timestamp
          path,
          url: publicUrl(path),
          kind: assetKind(o.metadata?.mimetype || o.name),
          size: o.metadata?.size ?? null,
          createdAt: o.created_at ?? null,
          // Where it was uploaded: null for the shared library, else the deck.
          deckId: folder === LIBRARY ? null : folder,
        };
      })
  );
}

/** Every uploaded asset, from the shared library and all decks, newest
 *  first. Storage listing isn't recursive, so this lists the top-level
 *  folders and then each folder's files (import copies stay excluded). */
export async function listAllAssets() {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list("", { limit: 1000 });
  if (error) throw error;
  const folders = (data || []).filter((o) => !o.id).map((o) => o.name);
  const lists = await Promise.all(folders.map(listFolder));
  return lists
    .flat()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

export async function deleteAsset(path) {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw error;
}
