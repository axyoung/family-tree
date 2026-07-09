// One-time migration: pushes everyone in src/data.js into your Supabase
// `people` table. Run this ONCE after setting up your Supabase project and
// filling in .env — re-running it is safe (it upserts, so it won't create
// duplicates), so feel free to run it again if you edit data.js and want to
// re-seed.
//
// Usage:
//   node scripts/seed.mjs

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { familyData } from "../src/data.js";

config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — check your .env file.");
  process.exit(1);
}

// Note: seeding writes directly to `people`, which RLS restricts to
// authenticated users only (see supabase/schema.sql). So this script signs
// in with your admin email/password first — pass them as arguments:
//   node scripts/seed.mjs you@example.com your-admin-password
const [email, password] = process.argv.slice(2);
if (!email || !password) {
  console.error("Usage: node scripts/seed.mjs <admin-email> <admin-password>");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
if (authError) {
  console.error("Login failed:", authError.message);
  process.exit(1);
}

const rows = familyData.map((person) => ({
  id: person.id,
  data: person.data,
  rels: person.rels,
}));

const { error } = await supabase.from("people").upsert(rows);

if (error) {
  console.error("Seed failed:", error.message);
  process.exit(1);
}

console.log(`Seeded ${rows.length} people into Supabase.`);
