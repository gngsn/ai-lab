import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** The one and only `createClient` call. Config is injected by the composition root. */
export function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      'Supabase backend selected but VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are unset.',
    );
  }
  return createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
}

export type { SupabaseClient };
