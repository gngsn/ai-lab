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

let deck, slide;
try {
  [deck, slide] = await Promise.all([getDeck(deckId), getOne(deckId, sectionId)]);
} catch (err) {
  fatal(`Load failed: ${err.message}`);
}

const slideHtml = tagSection(slide.content, slide.section_id);

let html = deck.frame_html;
if (html.includes("<!-- slides -->")) {
  html = html.replace("<!-- slides -->", slideHtml);
} else {
  html = html.replace(/<\/body>/i, `${slideHtml}</body>`);
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
