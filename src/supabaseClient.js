import { createClient } from "@supabase/supabase-js";

// These come from a .env file in the project root (not committed to git).
// See .env.example for what to fill in — you'll get both values from your
// Supabase project: Dashboard → Project Settings → Data API.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase credentials missing — copy .env.example to .env and fill in your project's URL and anon key."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Name of the public Storage bucket you create in the Supabase dashboard.
export const PHOTOS_BUCKET = "family-photos";
