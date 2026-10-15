/// <reference types="vite/client" />

// The only build-time variables the app reads (see src/config.ts). They end up
// in the public bundle, so they must be safe to publish.
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_OWNER_PASSPHRASE?: string;
}

declare module "/vendor/modules/supabase-client.mjs" {
  export function createClient(url: string, key: string): unknown;
}
