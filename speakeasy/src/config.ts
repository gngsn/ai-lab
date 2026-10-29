// App settings. They come from Vite env variables at build time, or, when a
// variable is unset, from the globals `config.local.js` puts on `window`. Both end up in public files: only values that are safe to publish
// belong here (the Supabase anon key, and today's client-side passphrase).
// Never add a token or API key.

export interface AppConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  ownerPassphrase: string;
}

type LegacyGlobals = {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  OWNER_PASSPHRASE?: string;
};

/** `env` and `globals` can be passed in for tests. */
export function getConfig(
  env: ImportMetaEnv = import.meta.env,
  globals: LegacyGlobals = typeof window === "undefined" ? {} : (window as LegacyGlobals),
): AppConfig {
  return {
    supabaseUrl: env.VITE_SUPABASE_URL || globals.SUPABASE_URL || "",
    supabaseAnonKey: env.VITE_SUPABASE_ANON_KEY || globals.SUPABASE_ANON_KEY || "",
    ownerPassphrase: env.VITE_OWNER_PASSPHRASE || globals.OWNER_PASSPHRASE || "",
  };
}
