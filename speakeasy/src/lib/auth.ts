import { getConfig } from "../config";

const TOKEN_KEY = "speakeasy:auth:token";
const LEGACY_TOKEN_KEY = "slides-editor:auth:token";

try {
  const legacy = localStorage.getItem(LEGACY_TOKEN_KEY);
  if (legacy !== null) {
    if (localStorage.getItem(TOKEN_KEY) === null) localStorage.setItem(TOKEN_KEY, legacy);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
  }
} catch {}

function askPassphrase(): Promise<string | null> {
  let layer = document.getElementById("__se_prompt_layer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "__se_prompt_layer";
    layer.style.cssText =
      "position:fixed;inset:0;z-index:10000;background:color-mix(in srgb, var(--se-bg, #f2f2f2) 85%, transparent);display:grid;place-items:center;padding:16px;";
    layer.innerHTML = `<div style="width:min(420px,100%);background:var(--se-bg,#f2f2f2);border:1px solid var(--se-ink,#292a2c);border-radius:0;padding:24px;color:var(--se-ink,#292a2c);font-family:inherit"><div id="__se_prompt_title" style="font-size:14px;font-weight:600;margin-bottom:8px"></div><div id="__se_prompt_message" style="font-size:12px;line-height:1.6;color:var(--se-muted,#6b6c6e);white-space:pre-wrap;margin-bottom:12px"></div><input id="__se_prompt_input" type="password" spellcheck="false" style="width:100%;box-sizing:border-box;background:transparent;border:none;border-bottom:1px solid var(--se-ink,#292a2c);color:var(--se-ink,#292a2c);border-radius:0;padding:8px 0;font:14px 'Space Grotesk','IBM Plex Sans KR',sans-serif;outline:none"/><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button id="__se_prompt_cancel" type="button" style="background:transparent;border:1px solid var(--se-ink,#292a2c);color:var(--se-ink,#292a2c);border-radius:0;padding:8px 14px;cursor:pointer">Cancel</button><button id="__se_prompt_ok" type="button" style="background:var(--se-primary,#ff8d70);border:1px solid var(--se-primary,#ff8d70);color:var(--se-on-primary,#1d1d1f);border-radius:0;padding:8px 14px;cursor:pointer;font-weight:500">OK</button></div></div>`;
    document.body.appendChild(layer);
  }
  const promptLayer = layer;
  const required = <T extends Element>(selector: string): T => {
    const element = promptLayer.querySelector<T>(selector);
    if (!element) throw new Error(`Missing prompt element: ${selector}`);
    return element;
  };
  const input = required<HTMLInputElement>("#__se_prompt_input");
  const title = required<HTMLElement>("#__se_prompt_title");
  const message = required<HTMLElement>("#__se_prompt_message");
  const ok = required<HTMLButtonElement>("#__se_prompt_ok");
  const cancel = required<HTMLButtonElement>("#__se_prompt_cancel");
  title.textContent = "Owner Passphrase";
  message.textContent = "Enter the passphrase to open this page.";
  return new Promise((resolve) => {
    const done = (value: string | null) => {
      promptLayer.style.display = "none";
      ok.onclick = null;
      cancel.onclick = null;
      input.onkeydown = null;
      promptLayer.onmousedown = null;
      resolve(value);
    };
    promptLayer.style.display = "grid";
    input.focus();
    input.select();
    ok.onclick = () => done(input.value);
    cancel.onclick = () => done(null);
    input.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        done(input.value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        done(null);
      }
    };
    promptLayer.onmousedown = (event) => {
      if (event.target === promptLayer) done(null);
    };
  });
}

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
