// Public viewer — validates ?token= against deck.share_token, sanitizes the
// slide HTML with DOMPurify, then renders read-only via SlidePresentation.
//
// Tier 1 protection: anyone with `deck_id + token` can read the slides.
// Notes are never fetched. No edit UI, no sync broadcast.
//
// Tier 2 (future): proper RLS that scopes anon access by share_token at the
// database layer so a leaked anon key alone can't pull all decks.

import DOMPurify from "https://esm.sh/dompurify@3";
import { getDeck } from "./repo/deck-repo.js";
import { listByDeck } from "./repo/slide-repo.js";
import { tagSection } from "./slide-render.js";

const params = new URLSearchParams(location.search);
const deckId = params.get("deck");
const token = params.get("token");

function fatal(msg) {
  document.body.innerHTML =
    `<pre style="font:14px monospace;color:#ef4444;padding:2rem;max-width:520px;margin:8vh auto;">` +
    msg.replace(
      /[&<>]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
    ) +
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
    FORBID_TAGS: [
      "script",
      "object",
      "embed",
      "iframe",
      "frame",
      "style",
      "link",
    ],
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

if (slides.length === 0) {
  fatal(`Deck '${deckId}' has no slides.`);
}

const slidesHtml = slides
  .map((s) => cleanSlide(tagSection(s.content, s.section_id)))
  .join("\n");

let html = cleanFrame(deck.frame_html);
if (html.includes("<!-- slides -->")) {
  html = html.replace("<!-- slides -->", slidesHtml);
} else {
  html = html.replace(/<\/body>/i, `${slidesHtml}</body>`);
}

const RUNTIME_URL = new URL("./js/slide-runtime.js", location.href).href;
const HELP_URL = new URL("./js/shortcuts-help.js", location.href).href;
const HELP_CSS = new URL("./css/shortcuts-help.css", location.href).href;

// View has runtime (nav/fragments) but no edit, no sync, no chrome.
// A faint footer notes the read-only state.
const overlay = `
<a href="./index.html" title="Home" style="position:fixed;top:8px;left:10px;z-index:9999;display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:rgba(20,20,20,.76);color:#f0f0f0;font:12px ui-monospace,monospace;text-decoration:none;pointer-events:auto;backdrop-filter:blur(8px);">⌂ Home</a>
<div style="position:fixed;top:6px;right:10px;font:10px ui-monospace,monospace;color:#666;letter-spacing:.05em;z-index:9999;text-align:right;pointer-events:none;">
  read-only · shared view
</div>
`;

// Same fallback as present-bootstrap — see comments there.
const noFallback =
  new URLSearchParams(location.search).get("nofallback") === "1";
const fallbackStyle = noFallback
  ? ""
  : `
<style id="__se_fallback">
  @media screen {
    html, body {
      overflow: hidden !important;
      height: 100% !important;
    }
    main {
      display: block !important;
      height: 100vh !important;
      max-height: 100vh !important;
      overflow-y: auto !important;
      overflow-x: hidden !important;
      scroll-snap-type: y mandatory !important;
      scroll-behavior: smooth !important;
      transform: none !important;
    }
    section[data-section-id] {
      scroll-snap-stop: always !important;
      scroll-snap-align: start !important;
      min-height: 100vh !important;
    }
  }
</style>
`;

const bootScript = `
${fallbackStyle}
<link rel="stylesheet" href="${HELP_CSS}" />
<script type="module">
  import { SlidePresentation } from "${RUNTIME_URL}";
  import { bindShortcutsHelp } from "${HELP_URL}";
  bindShortcutsHelp("View (shared)", [
    { keys: ["↓", "→", "PgDn", "Space"], desc: "Next slide / advance fragment" },
    { keys: ["↑", "←", "PgUp"], desc: "Previous slide / hide last fragment" },
    { keys: ["Home", "End"], desc: "Jump to first / last slide" },
    { keys: ["?"], desc: "This help" },
  ]);
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
