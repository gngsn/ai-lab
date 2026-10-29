// A one-line text prompt drawn in the page. The layer is created once and reused.
const PROMPT_HTML = `
    <div style="width:min(420px,100%);background:var(--se-bg, #f2f2f2);border:1px solid var(--se-ink, #292a2c);border-radius:0;padding:24px;color:var(--se-ink, #292a2c);font-family:inherit">
      <div id="__se_prompt_title" style="font-size:14px;font-weight:600;margin-bottom:8px"></div>
      <div id="__se_prompt_message" style="font-size:12px;line-height:1.6;color:var(--se-muted, #6b6c6e);white-space:pre-wrap;margin-bottom:12px"></div>
      <input id="__se_prompt_input" type="text" spellcheck="false" style="width:100%;box-sizing:border-box;background:transparent;border:none;border-bottom:1px solid var(--se-ink, #292a2c);color:var(--se-ink, #292a2c);border-radius:0;padding:8px 0;font:14px 'Space Grotesk', 'IBM Plex Sans KR', sans-serif;outline:none;" />
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
        <button id="__se_prompt_cancel" type="button" style="background:transparent;border:1px solid var(--se-ink, #292a2c);color:var(--se-ink, #292a2c);border-radius:0;padding:8px 14px;cursor:pointer">Cancel</button>
        <button id="__se_prompt_ok" type="button" style="background:var(--se-primary, #ff8d70);border:1px solid var(--se-primary, #ff8d70);color:var(--se-on-primary, #1d1d1f);border-radius:0;padding:8px 14px;cursor:pointer;font-weight:500">OK</button>
      </div>
    </div>`;

function ensureContainer(): HTMLElement {
  let layer = document.getElementById("__se_prompt_layer");
  if (layer) return layer;

  layer = document.createElement("div");
  layer.id = "__se_prompt_layer";
  layer.style.cssText =
    "position:fixed;inset:0;z-index:10000;background:color-mix(in srgb, var(--se-bg, var(--se-bg, #f2f2f2)) 85%, transparent);display:grid;place-items:center;padding:16px;";
  layer.innerHTML = PROMPT_HTML;
  document.body.appendChild(layer);
  return layer;
}

export type AskTextOptions = {
  title?: string;
  message?: string;
  defaultValue?: string;
  password?: boolean;
};

/** The entered text, or null when cancelled (Cancel, Esc, a click outside). */
export async function askText({
  title,
  message,
  defaultValue = "",
  password = false,
}: AskTextOptions): Promise<string | null> {
  const layer = ensureContainer();
  const part = <T extends HTMLElement>(selector: string) => {
    const element = layer.querySelector<T>(selector);
    if (!element) throw new Error(`Missing prompt element: ${selector}`);
    return element;
  };
  const input = part<HTMLInputElement>("#__se_prompt_input");
  const titleEl = part("#__se_prompt_title");
  const messageEl = part("#__se_prompt_message");
  const okBtn = part<HTMLButtonElement>("#__se_prompt_ok");
  const cancelBtn = part<HTMLButtonElement>("#__se_prompt_cancel");

  titleEl.textContent = title || "";
  messageEl.textContent = message || "";
  input.type = password ? "password" : "text";
  input.value = defaultValue;

  return await new Promise<string | null>((resolve) => {
    const cleanup = (result: string | null) => {
      layer.style.display = "none";
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      input.onkeydown = null;
      layer.onmousedown = null;
      resolve(result);
    };

    okBtn.onclick = () => cleanup(input.value);
    cancelBtn.onclick = () => cleanup(null);
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        cleanup(input.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        cleanup(null);
      }
    };
    layer.onmousedown = (e) => {
      if (e.target === layer) cleanup(null);
    };

    layer.style.display = "grid";
    input.focus();
    input.select();
  });
}
