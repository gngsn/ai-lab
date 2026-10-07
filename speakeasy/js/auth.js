// Tiny passphrase gate for the M3–M5 editor.
// Not real auth: anyone with the public site URL can guess. M6 replaces with
// Supabase Auth + owner-scoped RLS policies.
//
// The passphrase comes from `window.OWNER_PASSPHRASE` (set by config.local.js).
// Once accepted, a token is cached in localStorage so refreshes don't re-prompt.

import { askText } from "./dom-prompt.js";

const TOKEN_KEY = "speakeasy:auth:token";
const LEGACY_TOKEN_KEY = "slides-editor:auth:token"; // pre-rename name

// Carry a passphrase accepted under the old name over, so the rename
// doesn't log anyone out.
try {
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (legacy !== null) {
    if (localStorage.getItem(TOKEN_KEY) === null) {
      localStorage.setItem(TOKEN_KEY, legacy);
    }
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  }
} catch {}

export function isAuthed() {
  const want = window.OWNER_PASSPHRASE;
  if (!want || want === "set-me") return false;
  return localStorage.getItem(TOKEN_KEY) === want;
}

export async function ensureAuthed() {
  if (isAuthed()) return true;
  const want = window.OWNER_PASSPHRASE;
  if (!want || want === "set-me") {
    alert(
      "OWNER_PASSPHRASE not configured.\n" +
        "Edit js/config.local.js and set window.OWNER_PASSPHRASE.",
    );
    return false;
  }
  const input = await askText({
    title: "Owner Passphrase",
    message: "Enter the passphrase to open this page.",
    password: true,
  });
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
