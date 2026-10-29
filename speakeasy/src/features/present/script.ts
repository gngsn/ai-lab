// The presenter panel's script text → HTML: paragraphs, **bold**, `code`,
// dimmed cues / memos. Click cues are numbered so they can follow the slide's
// fragments.

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ESCAPES[c] as string);

// A click cue in the script: "(클릭)", "(click)", "(클릭 — …)".
const CLICK_CUE = /^\((클릭|click)(?![a-z])/i;

/** `shown` = how many of the slide's fragments are revealed: cues before that
 *  are done, the one at that number is next. */
export function renderScript(text: unknown, shown = 0): string {
  let cue = 0;
  return String(text || "")
    .trim()
    .split(/\n\s*\n/)
    .map((para) => {
      const lines = para.split("\n").map((raw) => {
        const line = raw.trim();
        const html = esc(line)
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/`([^`]+)`/g, "<code>$1</code>");
        if (/^\(.*\)$/.test(line)) {
          if (!CLICK_CUE.test(line)) return `<span class="cue">${html}</span>`;
          const n = cue++;
          const state = n < shown ? " done" : n === shown ? " next" : "";
          return `<span class="cue${state}" data-cue="${n}">${html}</span>`;
        }
        if (/^\/\*.*\*\/$/.test(line)) return `<span class="memo">${html}</span>`;
        return html;
      });
      return `<p>${lines.join("<br>")}</p>`;
    })
    .join("");
}
