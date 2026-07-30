import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // Muncul di console browser kalau env var belum diisi (lokal atau di Vercel).
  console.error(
    "VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY belum diset. Cek file .env.local (lokal) atau Environment Variables di Vercel."
  );
}

export const supabase = createClient(url, anonKey);
