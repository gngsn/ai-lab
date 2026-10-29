// The edit frame: a single-slide preview inside the editor's canvas iframe (and
// the pronunciation page's preview). Parallels the presenter page's bootstrap
// but renders ONE section (not all) and, with ?edit=1, adds the inline-editor
// runtime. Talks to the editor with postMessage (§2.4 of the plan):
//   edit-frame:request-data → edit-frame:data   (the editor's cached deck + slide)
//   edit-frame:error                            (the frame could not load)

import { getDeck } from "../../data/decks";
import { getOne } from "../../data/slides";
import type { DeckRow, SlideRow } from "../../data/types";
import { scriptJson } from "../../lib/script-json";
import { tagSection } from "../../lib/slide-render";
import { resolveStorageSourcesInHtml } from "../../lib/storage-src";

// What the frame showed before its slide arrived.
const LOADING_CSS = `
body { margin: 0; background: #f2f2f2; color: #6b6c6e;
  color-scheme: light dark;
       font: 13px ui-monospace, monospace;
       display: grid; place-items: center; height: 100vh; }
@media (prefers-color-scheme: dark) {
  body { background: #19191a; color: #9a9a9c; }
}`;

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

function fatal(msg: string): never {
  document.body.innerHTML = `<pre style="color:var(--se-bad, #b42318);padding:1rem;font:13px monospace;">${msg.replace(
    /[&<>]/g,
    (c) => ESC[c] as string,
  )}</pre>`;
  parent.postMessage({ type: "edit-frame:error", message: msg }, "*");
  throw new Error(msg);
}

type Data = { deck: DeckRow; slide: SlideRow };

// Try the parent's in-memory cache first (avoids a Supabase round-trip on every
// slide navigation when running inside the editor). Falls back to a direct
// fetch if the parent doesn't reply within a short window — covers a standalone
// open and the very first iframe load before the parent has finished its own
// initial fetch.
function requestDataFromParent(deckId: string, sectionId: string): Promise<Data> {
  return new Promise((resolve, reject) => {
    if (window.parent === window) {
      reject(new Error("standalone"));
      return;
    }
    const reqId = Math.random().toString(36).slice(2);
    const onMsg = (e: MessageEvent) => {
      const m = e.data;
      if (!m || m.type !== "edit-frame:data" || m.id !== reqId) return;
      cleanup();
      if (m.deck && m.slide) resolve({ deck: m.deck, slide: m.slide });
      else reject(new Error("missing"));
    };
    const t = setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, 800);
    function cleanup() {
      clearTimeout(t);
      window.removeEventListener("message", onMsg);
    }
    window.addEventListener("message", onMsg);
    window.parent.postMessage(
      { type: "edit-frame:request-data", id: reqId, deckId, sectionId },
      "*",
    );
  });
}

export async function bootEditFrame() {
  const style = document.createElement("style");
  style.textContent = LOADING_CSS;
  document.head.appendChild(style);
  document.body.innerHTML = "<p>loading slide…</p>";

  const params = new URLSearchParams(location.search);
  const deckId = params.get("deck");
  const sectionId = params.get("section");
  const editMode = params.get("edit") === "1";

  if (!deckId || !sectionId) fatal("Missing ?deck=<id>&section=<id>");

  let deck: DeckRow;
  let slide: SlideRow;
  try {
    ({ deck, slide } = await requestDataFromParent(deckId, sectionId));
  } catch {
    // Cache miss / standalone open → direct fetch as a fallback.
    try {
      [deck, slide] = await Promise.all([getDeck(deckId), getOne(deckId, sectionId)]);
    } catch (err) {
      fatal(`Load failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Older assets were inserted as supabase://… links; show them as public URLs.
  const slideHtml = resolveStorageSourcesInHtml(tagSection(slide.content, slide.section_id));

  let html = resolveStorageSourcesInHtml(deck.frame_html);
  if (html.includes("<!-- slides -->")) {
    html = html.replace("<!-- slides -->", () => slideHtml);
  } else {
    html = html.replace(/<\/body>/i, () => `${slideHtml}</body>`);
  }

  // Keep deck runtime scripts out of the inline editor. They may inject
  // presentation chrome (for example `.slide-header` / `.slide-footer`), and an
  // editor save would otherwise persist those generated nodes back into the
  // slide. CSS/styles are preserved so the editing canvas still matches the deck.
  if (editMode) {
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    html = html.replace(/<script\b[^>]*\/?>/gi, "");
  }

  const url = (path: string) => new URL(path, location.href).href;
  // Edit-mode overlay: dashed outline on editable nodes + cursor hint. In read
  // mode we still rewrite the document so the deck CSS applies, but don't load
  // the inline-editor module.
  const editChrome = editMode
    ? `
<link rel="stylesheet" href="${url("./css/edit-frame.css")}" />
<script type="module">
  import { mountEditFrame } from "${url("./js/edit-frame-overlay.js")}";
  mountEditFrame(${scriptJson({ deckId, sectionId })});
</script>`
    : "";

  html = html.replace(/<\/body>/i, () => `${editChrome}</body>`);

  document.open();
  document.write(html);
  document.close();
}
