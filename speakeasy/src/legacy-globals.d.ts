// Types of the globals that config.local.js and the runtime put on `window`.
export {};

declare global {
  interface Window {
    // set by config.local.js
    SUPABASE_URL?: string;
    SUPABASE_ANON_KEY?: string;
    OWNER_PASSPHRASE?: string;
    GITHUB_TOKEN?: string;
    // set by the pages
    __SE_SHARE?: boolean;
    __SE_E2E_FAKE__?: boolean;
  }
}
