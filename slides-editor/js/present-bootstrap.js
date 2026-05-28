// Bootstrap for present.html.
// 1. Resolve deck_id from `?deck=...` (or `/present/<id>` path fallback).
// 2. Fetch deck + slides.
// 3. Tag each section with data-section-id and join into frame_html's
//    `<!-- slides -->` placeholder.
// 4. Inject overlay (progress bar + sync indicator) and a runtime boot
//    `<script type="module">` near `</body>`.
// 5. Rewrite the document via document.open()/write()/close() so the deck's
//    frame_html (head styles, body layout) takes over completely.
//
// Note: `window` is preserved across document.write, so globals set by
// config.local.js (SUPABASE_URL/KEY) survive into the runtime script.

import { getDeck } from "./repo/deck-repo.js";
import { listByDeck } from "./repo/slide-repo.js";

const params = new URLSearchParams(location.search);
const pathMatch = location.pathname.match(/\/present\/([^/?]+)/);
const deckId = params.get("deck") || pathMatch?.[1];

function fatal(msg) {
  document.body.innerHTML =
    `<pre style="font:14px monospace;color:#ef4444;padding:2rem;">` +
    msg.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]) +
    `</pre>`;
  throw new Error(msg);
}

if (!deckId) fatal("Missing ?deck=<deck_id> in URL.");

let deck, slides;
try {
  [deck, slides] = await Promise.all([getDeck(deckId), listByDeck(deckId)]);
} catch (err) {
  fatal(`Failed to load deck '${deckId}': ${err.message}`);
}

if (!deck.frame_html) fatal(`Deck '${deckId}' has no frame_html.`);

// Tag each <section> with data-section-id so the runtime can read it from DOM.
const escAttr = (s) => String(s).replace(/"/g, "&quot;");
const slidesHtml = slides
  .map((s) =>
    s.content.replace(
      /<section\b/i,
      `<section data-section-id="${escAttr(s.section_id)}"`,
    ),
  )
  .join("\n");

let html = deck.frame_html;
if (html.includes("<!-- slides -->")) {
  html = html.replace("<!-- slides -->", slidesHtml);
} else {
  // Fallback: append before </body> so the deck still renders.
  console.warn("[present] frame_html missing <!-- slides --> placeholder");
  html = html.replace(/<\/body>/i, `${slidesHtml}</body>`);
}

const RUNTIME_URL = new URL("./js/slide-runtime.js", location.href).href;
const SYNC_URL = new URL("./js/sync.js", location.href).href;

const overlay = `
<div id="__se_progress" style="position:fixed;top:0;left:0;height:2px;width:0;background:#5db8a6;z-index:9999;transition:width .3s ease;"></div>
<div id="__se_chrome" style="position:fixed;top:6px;right:10px;font:11px ui-monospace,monospace;color:#888;letter-spacing:.04em;z-index:9999;text-align:right;line-height:1.5;pointer-events:auto;">
  <div id="__se_counter">— / —</div>
  <div id="__se_sync" style="opacity:.7;cursor:pointer;display:none;"></div>
</div>
`;

// The runtime boot runs in the rewritten document. Use absolute URLs since
// any <base href> the deck might add could shift relative resolution.
const bootScript = `
<script type="module">
  import { SlidePresentation } from "${RUNTIME_URL}";
  import { createSlideSync } from "${SYNC_URL}";

  const syncId = new URLSearchParams(location.search).get("sync");
  const counter = document.getElementById("__se_counter");
  const syncBadge = document.getElementById("__se_sync");
  const progress = document.getElementById("__se_progress");

  let sync = null;
  if (syncId) {
    sync = createSlideSync(syncId);
    if (syncBadge) {
      syncBadge.style.display = "block";
      syncBadge.textContent = "● sync: " + syncId;
      syncBadge.onclick = () => navigator.clipboard?.writeText(syncId);
    }
  }

  new SlidePresentation({
    onSlideChange: ({ index, section_id, total }) => {
      if (counter) counter.textContent = (index + 1) + " / " + total;
      if (progress) progress.style.width = ((index + 1) / Math.max(1, total)) * 100 + "%";
      if (sync) sync.broadcast({ section_id, index });
    },
  });
<\/script>
`;

// Note the escaped `</` above — keeps the bundler from misreading; in plain
// JS strings either form works, but the escape is safer if this file is ever
// inlined into HTML for debugging.

html = html.replace(/<\/body>/i, `${overlay}${bootScript}</body>`);

// Replace title if deck has one and frame_html's title is generic.
if (deck.title && /<title>[^<]*<\/title>/i.test(html)) {
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${deck.title}</title>`);
}

document.open();
document.write(html);
document.close();
