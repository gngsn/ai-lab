// Tiny passphrase gate for the M3–M5 editor.
// Not real auth: anyone with the public site URL can guess. M6 replaces with
// Supabase Auth + owner-scoped RLS policies.
//
// The passphrase comes from `window.OWNER_PASSPHRASE` (set by config.local.js).
// Once accepted, a token is cached in localStorage so refreshes don't re-prompt.

const TOKEN_KEY = "slides-editor:auth:token";

export function isAuthed() {
  const want = window.OWNER_PASSPHRASE;
  if (!want || want === "set-me") return false;
  return localStorage.getItem(TOKEN_KEY) === want;
}

export function ensureAuthed() {
  if (isAuthed()) return true;
  const want = window.OWNER_PASSPHRASE;
  if (!want || want === "set-me") {
    alert(
      "OWNER_PASSPHRASE not configured.\n" +
        "Edit js/config.local.js and set window.OWNER_PASSPHRASE.",
    );
    return false;
  }
  const input = prompt("Owner passphrase:");
  if (input && input === want) {
    localStorage.setItem(TOKEN_KEY, input);
    return true;
  }
  alert("Wrong passphrase. Edit access denied.");
  return false;
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY);
}
