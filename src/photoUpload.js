import imageCompression from "browser-image-compression";
import { supabase, PHOTOS_BUCKET } from "./supabaseClient.js";

async function compressImage(file) {
  try {
    return await imageCompression(file, {
      maxSizeMB: 0.22, // targets ~75-220KB, roughly half of before
      maxWidthOrHeight: 1600,
      initialQuality: 0.7,
      useWebWorker: true,
    });
  } catch (err) {
    console.warn(`Compression failed for ${file.name}, uploading original:`, err);
    return file;
  }
}

// Uploads each staged file to Supabase Storage under a folder named after
// the person's id, and returns { url, caption, path } objects ready to
// append to that person's `photos` array. `path` is kept so we can delete
// the actual file later (removing it from `photos` alone doesn't free
// storage space).
export async function uploadPhotos(personId, stagedFiles) {
  const uploaded = [];

  for (const { file, caption } of stagedFiles) {
    const compressed = await compressImage(file);
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const path = `${personId}/${crypto.randomUUID()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .upload(path, compressed);

    if (uploadError) {
      throw new Error(`Failed to upload ${file.name}: ${uploadError.message}`);
    }

    const { data } = supabase.storage.from(PHOTOS_BUCKET).getPublicUrl(path);
    uploaded.push({ url: data.publicUrl, caption: caption || "", path });
  }

  return uploaded;
}

// Older photo entries (uploaded before `path` was tracked) only have a
// `url`. Derive the storage path from the public URL so deletion still
// works for those too.
function pathFromPublicUrl(url) {
  const marker = `/object/public/${PHOTOS_BUCKET}/`;
  const idx = url?.indexOf(marker);
  if (idx == null || idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

// Actually deletes files from Storage. Accepts photo objects ({url, path?})
// or raw path strings.
export async function deletePhotos(photosOrPaths) {
  const paths = photosOrPaths
    .map((p) => (typeof p === "string" ? p : p.path || pathFromPublicUrl(p.url)))
    .filter(Boolean);

  if (!paths.length) return;

  const { error } = await supabase.storage.from(PHOTOS_BUCKET).remove(paths);
  if (error) {
    console.error("Failed to delete storage files:", error.message, paths);
  }
}

// Deletes every file under a person's storage folder (used when a person
// is deleted entirely, so their avatar + all gallery photos are cleaned up
// without needing to enumerate them individually).
export async function deleteAllPhotosForPerson(personId) {
  const { data: files, error: listError } = await supabase.storage.from(PHOTOS_BUCKET).list(personId);
  if (listError) {
    console.error(`Failed to list storage files for ${personId}:`, listError.message);
    return;
  }
  if (!files?.length) return;

  const paths = files.map((f) => `${personId}/${f.name}`);
  const { error } = await supabase.storage.from(PHOTOS_BUCKET).remove(paths);
  if (error) {
    console.error(`Failed to delete storage files for ${personId}:`, error.message);
  }
}
