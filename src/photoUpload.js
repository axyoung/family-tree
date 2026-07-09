import imageCompression from "browser-image-compression";
import { supabase, PHOTOS_BUCKET } from "./supabaseClient.js";

async function compressImage(file) {
  try {
    return await imageCompression(file, {
      maxSizeMB: 0.45, // targets ~150-450KB in practice
      maxWidthOrHeight: 1920,
      initialQuality: 0.8,
      useWebWorker: true,
    });
  } catch (err) {
    console.warn(`Compression failed for ${file.name}, uploading original:`, err);
    return file;
  }
}

// Uploads each staged file to Supabase Storage under a folder named after
// the person's id, and returns { url, caption } objects ready to append to
// that person's `photos` array.
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
    uploaded.push({ url: data.publicUrl, caption: caption || "" });
  }

  return uploaded;
}
