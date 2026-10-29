import { getConfig } from "../config";
import { askText } from "./dom-prompt";

const TOKEN_KEY = "speakeasy:auth:token";
const LEGACY_TOKEN_KEY = "slides-editor:auth:token";

try {
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (legacy !== null) {
    if (localStorage.getItem(TOKEN_KEY) === null) localStorage.setItem(TOKEN_KEY, legacy);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  }
} catch {}

const askPassphrase = () =>
  askText({
    title: "Owner Passphrase",
    message: "Enter the passphrase to open this page.",
    password: true,
  });

export function isAuthed(): boolean {
  const want = getConfig().ownerPassphrase;
  if (!want || want === "set-me") return false;
  return localStorage.getItem(TOKEN_KEY) === want;
}

export async function ensureAuthed(): Promise<boolean> {
  if (isAuthed()) return true;
  const want = getConfig().ownerPassphrase;
  if (!want || want === "set-me") {
    alert(
      "OWNER_PASSPHRASE not configured.\nEdit js/config.local.js and set window.OWNER_PASSPHRASE.",
    );
    return false;
  }
  const input = await askPassphrase();
  if (input && input === want) {
    localStorage.setItem(TOKEN_KEY, input);
    return true;
  }
  alert("Wrong passphrase. Edit access denied.");
  return false;
}
