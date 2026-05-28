// Public viewer — validates ?token= against deck.share_token, sanitizes the
// slide HTML with DOMPurify, then renders read-only via SlidePresentation.
//
// Tier 1 protection: anyone with `deck_id + token` can read the slides.
// Notes are never fetched. No edit UI, no sync broadcast.
//
// Tier 2 (future): proper RLS that scopes anon access by share_token at the
// database layer so a leaked anon key alone can't pull all decks.

import { getDeck } from "./repo/deck-repo.js";
import { listByDeck } from "./repo/slide-repo.js";
import DOMPurify from "https://esm.sh/dompurify@3";

const params = new URLSearchParams(location.search);
const deckId = params.get("deck");
const token = params.get("token");

function fatal(msg) {
  document.body.innerHTML =
    `<pre style="font:14px monospace;color:#ef4444;padding:2rem;max-width:520px;margin:8vh auto;">` +
    msg.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]) +
    `</pre>`;
  throw new Error(msg);
}

if (!deckId) fatal("Missing ?deck=<deck_id>");
if (!token) fatal("Missing ?token=<share_token>");

let deck;
try {
  deck = await getDeck(deckId);
} catch (err) {
  fatal(`Cannot open deck: ${err.message}`);
}

if (!deck.share_token) {
  fatal("This deck is not shared. Ask the owner to enable sharing.");
}
if (deck.share_token !== token) {
  fatal("Invalid or revoked share link.");
}

let slides;
try {
  slides = await listByDeck(deckId);
} catch (err) {
  fatal(`Cannot load slides: ${err.message}`);
}

// Sanitize the slide content — DOMPurify strips <script>, on*= handlers,
// and dangerous tags. We also forbid <style>/<link> at the slide level so
// shared decks can't introduce new CSS during view.
const cleanSlide = (html) =>
  DOMPurify.sanitize(html, {
    FORBID_TAGS: ["script", "object", "embed", "iframe", "frame", "style", "link"],
  });

// frame_html (the deck shell) is harder to sanitize as a whole document —
// DOMPurify works on fragments. Strip <script> tags + inline on* handlers
// via regex; everything else (style, link, body layout) stays.
const cleanFrame = (html) =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/?\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");

const escAttr = (s) => String(s).replace(/"/g, "&quot;");
const slidesHtml = slides
  .map((s) =>
    cleanSlide(
      s.content.replace(
        /<section\b/i,
        `<section data-section-id="${escAttr(s.section_id)}"`,
      ),
    ),
  )
  .join("\n");

let html = cleanFrame(deck.frame_html);
if (html.includes("<!-- slides -->")) {
  html = html.replace("<!-- slides -->", slidesHtml);
} else {
  html = html.replace(/<\/body>/i, `${slidesHtml}</body>`);
}

const RUNTIME_URL = new URL("./js/slide-runtime.js", location.href).href;

// View has runtime (nav/fragments) but no edit, no sync, no chrome.
// A faint footer notes the read-only state.
const overlay = `
<div style="position:fixed;top:6px;right:10px;font:10px ui-monospace,monospace;color:#666;letter-spacing:.05em;z-index:9999;text-align:right;pointer-events:none;">
  read-only · shared view
</div>
`;

const bootScript = `
<script type="module">
  import { SlidePresentation } from "${RUNTIME_URL}";
  new SlidePresentation({});
<\/script>
`;

html = html.replace(/<\/body>/i, `${overlay}${bootScript}</body>`);

if (deck.title && /<title>[^<]*<\/title>/i.test(html)) {
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${deck.title}</title>`);
}

document.open();
document.write(html);
document.close();
