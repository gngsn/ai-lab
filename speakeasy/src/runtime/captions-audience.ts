// Live captions — English subtitles on the audience page (share). Bundled to
// /js/captions/audience.js and mounted by the view runtime with one optional
// import; nothing shows until the first caption arrives, so decks without
// captions look the same.
import { openCaptionChannel } from "./captions-channel";

const PREF_KEY = "speakeasy:captions:on";
const HIDE_AFTER_MS = 12000; // clear a caption the speaker has moved past

const CSS = `
#__se_cc_box {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(max(14px, env(safe-area-inset-bottom)) + var(--se-cc-lift, 0px));
  z-index: 10; width: max-content; max-width: min(760px, calc(100vw - 24px));
  padding: 8px 14px; border-radius: 10px; background: rgba(12,12,12,.86);
  color: #f4f4f4; font: 500 16px/1.45 system-ui, sans-serif; text-align: center;
  pointer-events: none; opacity: 0; transition: opacity .25s ease;
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
}
#__se_cc_box.show { opacity: 1; }
#__se_cc_box.mt { color: #cfcfcf; font-style: italic; }
#__se_cc_toggle {
  position: fixed; top: max(8px, env(safe-area-inset-top)); left: 10px;
  z-index: 10; display: none; cursor: pointer;
  font: 600 11px ui-monospace, monospace; letter-spacing: .06em;
  color: #f0f0f0; background: rgba(20,20,20,.8);
  border: 1px solid rgba(255,255,255,.18); border-radius: 999px;
  padding: 6px 11px;
}
#__se_cc_toggle[aria-pressed="false"] { color: #8a8a8a; text-decoration: line-through; }
@media (hover: none) and (pointer: coarse) {
  /* Sit above the < > step buttons (the letterbox page). */
  #__se_cc_box { --se-cc-lift: 56px; }
}
`;

/** ui: the document to draw in (the letterbox page around the slide). */
export function mountCaptions({ room, ui = document }: { room: string; ui?: Document }) {
  const ko = /^ko(-|$)/i.test(navigator.languages?.[0] || navigator.language || "");
  const style = ui.createElement("style");
  style.textContent = CSS;
  const box = ui.createElement("div");
  box.id = "__se_cc_box";
  box.setAttribute("role", "status");
  box.setAttribute("aria-live", "polite");
  const toggle = ui.createElement("button");
  toggle.id = "__se_cc_toggle";
  toggle.type = "button";
  toggle.textContent = "CC";
  toggle.title = ko ? "영어 자막 켜기/끄기" : "Show / hide English captions";
  ui.getElementById("__se_cc_box")?.remove();
  ui.getElementById("__se_cc_toggle")?.remove();
  ui.head.appendChild(style);
  ui.body.append(box, toggle);

  let on = true;
  try {
    on = localStorage.getItem(PREF_KEY) !== "0";
  } catch {}
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const render = () => {
    toggle.setAttribute("aria-pressed", String(on));
    if (!on) box.classList.remove("show");
  };
  toggle.addEventListener("click", () => {
    on = !on;
    try {
      localStorage.setItem(PREF_KEY, on ? "1" : "0");
    } catch {}
    render();
  });
  render();

  return openCaptionChannel(room, {
    onCaption: ({ en, mt } = {}) => {
      if (!en) return;
      toggle.style.display = "block"; // captions exist for this talk
      box.textContent = en;
      box.classList.toggle("mt", Boolean(mt));
      if (!on) return;
      box.classList.add("show");
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => box.classList.remove("show"), HIDE_AFTER_MS);
    },
  });
}
