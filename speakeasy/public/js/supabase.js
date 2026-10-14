// Single Supabase client for the whole app.
// Loaded after `config.local.js` (which sets the globals on `window`).
import { createClient } from "../vendor/modules/supabase-client.mjs";

const url = window.SUPABASE_URL;
const key = window.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error(
    "[supabase] SUPABASE_URL / SUPABASE_ANON_KEY missing — copy " +
      "js/config.local.js.example to js/config.local.js and fill in.",
  );
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});
