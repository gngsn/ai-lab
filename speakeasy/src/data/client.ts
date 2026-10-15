// The one place the Supabase SDK is created. Everything else in the app talks
// to the database through the functions in this folder.
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "../config";
import type { Database } from "./types";

const { supabaseUrl, supabaseAnonKey } = getConfig();

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "[supabase] SUPABASE_URL / SUPABASE_ANON_KEY missing — set VITE_SUPABASE_URL / " +
      "VITE_SUPABASE_ANON_KEY, or fill public/js/config.local.js.",
  );
}

const testFake =
  typeof window !== "undefined" &&
  (window as Window & { __SE_E2E_FAKE__?: boolean }).__SE_E2E_FAKE__;

// Playwright replaces this URL with the existing in-browser fake backend. The
// specifier is a variable on purpose: the file lives in public/ (served as is),
// so Vite must not try to bundle it.
const FAKE_CLIENT_URL = "/vendor/modules/supabase-client.mjs";

export const supabase = testFake
  ? ((await import(/* @vite-ignore */ FAKE_CLIENT_URL).then(
      ({ createClient }: { createClient: (url: string, key: string) => unknown }) =>
        createClient(supabaseUrl, supabaseAnonKey),
    )) as unknown as ReturnType<typeof createSupabaseClient<Database>>)
  : createSupabaseClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
    });
