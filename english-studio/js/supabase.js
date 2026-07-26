// Single Supabase client for the whole app.
// Loaded after `config.local.js` (which sets the globals on `window`).
// Reuses the same Supabase project as slides-editor — just a different
// table (`vocab_lookups`), same account, same dev_anon_all RLS posture.
import { createClient } from "../vendor/modules/supabase-client.mjs";

const url = window.SUPABASE_URL;
const key = window.SUPABASE_ANON_KEY;

if (!url || !key) {
  console.warn(
    "[supabase] SUPABASE_URL / SUPABASE_ANON_KEY missing — vocabulary " +
      "lookups won't be persisted. Edit js/config.local.js.",
  );
}

export const supabase = url && key
  ? createClient(url, key, { auth: { persistSession: false } })
  : null;
