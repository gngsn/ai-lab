function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[c],
  );
}

function ensureContainer() {
  let layer = document.getElementById("__se_prompt_layer");
  if (layer) return layer;

  layer = document.createElement("div");
  layer.id = "__se_prompt_layer";
  layer.style.cssText =
    "position:fixed;inset:0;z-index:10000;background:color-mix(in srgb, var(--se-bg, var(--se-bg, #f2f2f2)) 85%, transparent);display:grid;place-items:center;padding:16px;";
  layer.innerHTML = `
    <div style="width:min(420px,100%);background:var(--se-bg, #f2f2f2);border:1px solid var(--se-ink, #292a2c);border-radius:0;padding:24px;color:var(--se-ink, #292a2c);font-family:inherit">
      <div id="__se_prompt_title" style="font-size:14px;font-weight:600;margin-bottom:8px"></div>
      <div id="__se_prompt_message" style="font-size:12px;line-height:1.6;color:var(--se-muted, #6b6c6e);white-space:pre-wrap;margin-bottom:12px"></div>
      <input id="__se_prompt_input" type="text" spellcheck="false" style="width:100%;box-sizing:border-box;background:transparent;border:none;border-bottom:1px solid var(--se-ink, #292a2c);color:var(--se-ink, #292a2c);border-radius:0;padding:8px 0;font:14px 'Space Grotesk', 'IBM Plex Sans KR', sans-serif;outline:none;" />
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
        <button id="__se_prompt_cancel" type="button" style="background:transparent;border:1px solid var(--se-ink, #292a2c);color:var(--se-ink, #292a2c);border-radius:0;padding:8px 14px;cursor:pointer">Cancel</button>
        <button id="__se_prompt_ok" type="button" style="background:var(--se-primary, #ff8d70);border:1px solid var(--se-primary, #ff8d70);color:var(--se-on-primary, #1d1d1f);border-radius:0;padding:8px 14px;cursor:pointer;font-weight:500">OK</button>
      </div>
    </div>`;
  document.body.appendChild(layer);
  return layer;
}

export async function askText({
  title,
  message,
  defaultValue = "",
  password = false,
}) {
  const layer = ensureContainer();
  const input = layer.querySelector("#__se_prompt_input");
  const titleEl = layer.querySelector("#__se_prompt_title");
  const messageEl = layer.querySelector("#__se_prompt_message");
  const okBtn = layer.querySelector("#__se_prompt_ok");
  const cancelBtn = layer.querySelector("#__se_prompt_cancel");

  titleEl.textContent = title || "";
  messageEl.textContent = message || "";
  input.type = password ? "password" : "text";
  input.value = defaultValue;

  return await new Promise((resolve) => {
    const cleanup = (result) => {
      layer.style.display = "none";
      okBtn.onclick = null;
      cancelBtn.onclick = null;
      input.onkeydown = null;
      layer.onmousedown = null;
      resolve(result);
    };

    const show = () => {
      layer.style.display = "grid";
      input.focus();
      input.select();
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

    show();
  });
}
