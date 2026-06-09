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
    "position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.72);display:grid;place-items:center;padding:16px;";
  layer.innerHTML = `
    <div style="width:min(420px,100%);background:#141414;border:1px solid #2a2a2a;border-radius:12px;padding:18px 18px 16px;color:#f0f0f0;font-family:inherit;box-shadow:0 18px 60px rgba(0,0,0,.45)">
      <div id="__se_prompt_title" style="font-size:14px;font-weight:600;margin-bottom:8px"></div>
      <div id="__se_prompt_message" style="font-size:12px;line-height:1.6;color:#a8a8a8;white-space:pre-wrap;margin-bottom:12px"></div>
      <input id="__se_prompt_input" type="text" spellcheck="false" style="width:100%;box-sizing:border-box;background:#0c0c0c;border:1px solid #333;color:#f0f0f0;border-radius:8px;padding:10px 12px;font:13px 'JetBrains Mono', ui-monospace, monospace;outline:none;" />
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px">
        <button id="__se_prompt_cancel" type="button" style="background:transparent;border:1px solid #333;color:#a8a8a8;border-radius:8px;padding:8px 12px;cursor:pointer">Cancel</button>
        <button id="__se_prompt_ok" type="button" style="background:#5db8a6;border:1px solid #5db8a6;color:#0c0c0c;border-radius:8px;padding:8px 12px;cursor:pointer;font-weight:600">OK</button>
      </div>
    </div>`;
  document.body.appendChild(layer);
  return layer;
}

export async function askText({ title, message, defaultValue = "", password = false }) {
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
