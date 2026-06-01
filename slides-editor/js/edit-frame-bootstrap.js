// Bootstrap for edit-frame.html — single-slide preview inside the editor iframe.
// Parallels present-bootstrap.js but renders ONE section (not all) and
// optionally injects the inline-editor runtime when ?edit=1.
import { getDeck } from "./repo/deck-repo.js";
import { getOne } from "./repo/slide-repo.js";
import { tagSection } from "./slide-render.js";

const params = new URLSearchParams(location.search);
const deckId = params.get("deck");
const sectionId = params.get("section");
const editMode = params.get("edit") === "1";

function fatal(msg) {
  document.body.innerHTML = `<pre style="color:#ef4444;padding:1rem;font:13px monospace;">${msg.replace(
    /[&<>]/g,
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
    fatal(`Load failed: ${err.message}`);
  }
}

const slideHtml = tagSection(slide.content, slide.section_id);

let html = deck.frame_html;
if (html.includes("<!-- slides -->")) {
  html = html.replace("<!-- slides -->", slideHtml);
} else {
  html = html.replace(/<\/body>/i, `${slideHtml}</body>`);
}

// In edit mode, strip the deck's own <script> tags. Slide-nav scripts
// (e.g., the v5 SlidePresentation) register keydown handlers that swallow
// typing inside the inline editor. CSS/styles are preserved, so the slide
// still looks right; only the deck's JS behavior is disabled while editing.
if (editMode) {
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  html = html.replace(/<script\b[^>]*\/>/gi, "");
}

const EDITOR_URL = new URL("./js/inline-editor.js", location.href).href;

// Edit-mode overlay: dashed outline on editable nodes + cursor hint.
// In read-mode we still rewrite the document so the deck CSS applies, but
// don't load the inline-editor module.
const editChrome = editMode
  ? `
<style>
  body.edit-active [data-editable] {
    outline: 1px dashed rgba(93,184,166,.45);
    outline-offset: 3px;
    cursor: text;
    transition: outline-color .15s;
  }
  body.edit-active [data-editable]:hover { outline-color: #5db8a6; }
  body.edit-active [data-editable]:focus {
    outline: 2px solid #5db8a6; outline-offset: 3px;
  }
</style>
<script type="module">
  import { InlineEditor } from "${EDITOR_URL}";
  document.body.classList.add("edit-active");
  // The deck's own bootstrap scripts were stripped (they intercept keys);
  // but many deck designs use a "first slide gets .visible, animations
  // fire on .visible / .show" pattern. Without those classes, reveal-style
  // animations stay at opacity:0 and the text is invisible. Force-promote
  // them so editors see the final, fully-revealed state.
  document.querySelectorAll(".slide").forEach((s) => s.classList.add("visible"));
  document.querySelectorAll(".fragment").forEach((f) => f.classList.add("show"));
  // Key-input shield: belt-and-suspenders in case any deck listener slipped
  // through. Stop key events that originate in an editable surface before
  // they bubble to deck-level handlers.
  ["keydown", "keypress", "keyup"].forEach((evt) => {
    document.addEventListener(evt, (e) => {
      const t = e.target;
      if (t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) {
        e.stopImmediatePropagation();
      }
    }, { capture: true });
  });
  new InlineEditor({
    deckId: ${JSON.stringify(deckId)},
    sectionId: ${JSON.stringify(sectionId)},
  });
<\/script>`
  : "";

html = html.replace(/<\/body>/i, `${editChrome}</body>`);

document.open();
document.write(html);
document.close();
