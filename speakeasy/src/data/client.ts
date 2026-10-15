// The one place the Supabase SDK is created. Everything else in the app talks
// to the database through the functions in this folder.
import { createClient } from "@supabase/supabase-js";
import { getConfig } from "../config";
import type { Database } from "./types";

const { supabaseUrl, supabaseAnonKey } = getConfig();

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "[supabase] SUPABASE_URL / SUPABASE_ANON_KEY missing — set VITE_SUPABASE_URL / " +
      "VITE_SUPABASE_ANON_KEY, or fill public/js/config.local.js.",
  );
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
});
