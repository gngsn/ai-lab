// @ts-check
// Bootstrap for edit-frame.html — single-slide preview inside the editor iframe.
// Parallels present-bootstrap.js but renders ONE section (not all) and
// optionally injects the inline-editor runtime when ?edit=1.
import { getDeck } from "./repo/deck-repo.js";
import { getOne } from "./repo/slide-repo.js";
import { tagSection } from "./slide-render.js";
import { resolveStorageSourcesInHtml } from "./storage-src.js";

const params = new URLSearchParams(location.search);
const deckId = params.get("deck");
const sectionId = params.get("section");
const editMode = params.get("edit") === "1";

/** @param {string} msg */
function fatal(msg) {
  document.body.innerHTML = `<pre style="color:var(--se-bad, #b42318);padding:1rem;font:13px monospace;">${msg.replace(
    /[&<>]/g,
    // @ts-expect-error — indexing a literal map by the matched character
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
  )}</pre>`;
  parent.postMessage({ type: "edit-frame:error", message: msg }, "*");
  throw new Error(msg);
}

if (!deckId || !sectionId) fatal("Missing ?deck=<id>&section=<id>");

// Try parent's in-memory cache first (avoids a Supabase round-trip on every
// slide navigation when running inside the editor). Falls back to a direct
// fetch if the parent doesn't reply within a short window — covers standalone
// open of edit-frame.html and the very first iframe load before the parent
// has finished its own initial fetch.
function requestDataFromParent() {
  return new Promise((resolve, reject) => {
    if (window.parent === window) {
      reject(new Error("standalone"));
      return;
    }
    const reqId = Math.random().toString(36).slice(2);
    /** @param {MessageEvent} e */
    const onMsg = (e) => {
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

let deck, slide;
try {
  ({ deck, slide } = await requestDataFromParent());
} catch {
  // Cache miss / standalone open → direct fetch as a fallback.
  try {
    [deck, slide] = await Promise.all([
      getDeck(deckId),
      getOne(deckId, sectionId),
    ]);
  } catch (err) {
    // @ts-expect-error — `err` is unknown in a JS catch clause (casting it would change code)
    fatal(`Load failed: ${err.message}`);
  }
}

// Older assets were inserted as supabase://… links; show them as public URLs.
const slideHtml = resolveStorageSourcesInHtml(
  tagSection(slide.content, slide.section_id),
);

let html = resolveStorageSourcesInHtml(deck.frame_html);
if (html.includes("<!-- slides -->")) {
  html = html.replace("<!-- slides -->", slideHtml);
} else {
  html = html.replace(/<\/body>/i, `${slideHtml}</body>`);
}

// Keep deck runtime scripts out of the inline editor. They may inject
// presentation chrome (for example `.slide-header` / `.slide-footer`), and an
// editor save would otherwise persist those generated nodes back into the
// slide. CSS/styles are preserved so the editing canvas still matches the deck.
if (editMode) {
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<script\b[^>]*\/?>/gi, "");
}

const EDIT_FRAME_CSS = new URL("./css/edit-frame.css", location.href).href;
const EDIT_FRAME_OVERLAY_URL = new URL(
  "./js/edit-frame-overlay.js",
  location.href,
).href;

// Edit-mode overlay: dashed outline on editable nodes + cursor hint.
// In read-mode we still rewrite the document so the deck CSS applies, but
// don't load the inline-editor module.
const editChrome = editMode
  ? `
<link rel="stylesheet" href="${EDIT_FRAME_CSS}" />
<script type="module">
  import { mountEditFrame } from "${EDIT_FRAME_OVERLAY_URL}";
  mountEditFrame({
    deckId: ${JSON.stringify(deckId)},
    sectionId: ${JSON.stringify(sectionId)},
  });
<\/script>`
  : "";

html = html.replace(/<\/body>/i, `${editChrome}</body>`);

document.open();
document.write(html);
document.close();
