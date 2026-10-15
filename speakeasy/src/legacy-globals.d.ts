// Types for the globals the legacy pages put on `window` (public/js). Type
// declarations only: they exist so `// @ts-check` files can use them.
export {};

declare global {
  interface Window {
    // set by public/js/config.local.js
    SUPABASE_URL?: string;
    SUPABASE_ANON_KEY?: string;
    OWNER_PASSPHRASE?: string;
    GITHUB_TOKEN?: string;
    // set by the pages
    __SE_SHARE?: boolean;
  }
}
