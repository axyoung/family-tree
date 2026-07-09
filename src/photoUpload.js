import { supabase, PHOTOS_BUCKET } from "./supabaseClient.js";

// Uploads each staged file to Supabase Storage under a folder named after
// the person's id, and returns { url, caption } objects ready to append to
// that person's `photos` array.
export async function uploadPhotos(personId, stagedFiles) {
  const uploaded = [];

  for (const { file, caption } of stagedFiles) {
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const path = `${personId}/${crypto.randomUUID()}-${safeName}`;

    const { error: uploadError } = await supabase.storage
      .from(PHOTOS_BUCKET)
      .upload(path, file);

    if (uploadError) {
      throw new Error(`Failed to upload ${file.name}: ${uploadError.message}`);
    }

    const { data } = supabase.storage.from(PHOTOS_BUCKET).getPublicUrl(path);
    uploaded.push({ url: data.publicUrl, caption: caption || "" });
  }

  return uploaded;
}
