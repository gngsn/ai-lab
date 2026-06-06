// Bootstrap for present.html.
// 1. Resolve deck_id from `?deck=...` (or `/present/<id>` path fallback).
// 2. Fetch deck + slides.
// 3. Tag each section with data-section-id and join into frame_html's
//    `<!-- slides -->` placeholder.
// 4. Inject overlay (progress bar + sync indicator) and a runtime boot
//    `<script type="module">` near `</body>`.
// 5. `?print=1` mode: skip chrome + sync, expand all fragments/reveals,
//    inject print-friendly CSS, and call window.print() after a short delay.
// 6. Rewrite the document via document.open()/write()/close() so the deck's
//    frame_html (head styles, body layout) takes over completely.
//
// `window` is preserved across document.write, so globals set by
// config.local.js (SUPABASE_URL/KEY) survive into the rewritten document.

import { ensureAuthed } from "./auth.js";
import { getDeck } from "./repo/deck-repo.js";
import { listByDeck } from "./repo/slide-repo.js";
import { tagSection } from "./slide-render.js";
import { isSlideHiddenContent } from "./slide-visibility.js";

if (!ensureAuthed()) {
  document.body.innerHTML =
    '<p style="padding:2rem;color:#ef4444;font-family:monospace">' +
    "Access denied — present is owner-only. Use view.html?token=… for sharing.</p>";
  throw new Error("auth");
}

const params = new URLSearchParams(location.search);
const pathMatch = location.pathname.match(/\/present\/([^/?]+)/);
const deckId = params.get("deck") || pathMatch?.[1];
const isPrint = params.get("print") === "1";
const startSectionId = params.get("section") || params.get("slide");

function fatal(msg) {
  document.body.innerHTML =
    `<pre style="font:14px monospace;color:#ef4444;padding:2rem;">` +
    msg.replace(
      /[&<>]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c],
    ) +
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

// Tag every section: ensure data-section-id (for runtime/sync identity) AND
// `class="slide"` (for nav selector + print CSS). Sections from imported decks
// that already had either are unchanged.
const visibleSlides = slides
  .map((slide, index) => ({ slide, index }))
  .filter(({ slide }) => !isSlideHiddenContent(slide.content));

const slidesHtml = visibleSlides
  .map(({ slide }) => tagSection(slide.content, slide.section_id))
  .join("\n");

if (visibleSlides.length === 0) {
  fatal(`Deck '${deckId}' has no visible slides.`);
}

function resolveStartIndex() {
  if (!startSectionId) return 0;
  const exact = visibleSlides.findIndex(
    ({ slide }) => slide.section_id === startSectionId,
  );
  if (exact !== -1) return exact;

  const targetFullIndex = slides.findIndex(
    (slide) => slide.section_id === startSectionId,
  );
  if (targetFullIndex === -1) return 0;

  const forward = visibleSlides.findIndex(
    ({ index }) => index >= targetFullIndex,
  );
  if (forward !== -1) return forward;

  for (let i = visibleSlides.length - 1; i >= 0; i--) {
    if (visibleSlides[i].index < targetFullIndex) return i;
  }
  return 0;
}

const startIndex = resolveStartIndex();

let html = deck.frame_html;
if (html.includes("<!-- slides -->")) {
  html = html.replace("<!-- slides -->", slidesHtml);
} else {
  console.warn("[present] frame_html missing <!-- slides --> placeholder");
  html = html.replace(/<\/body>/i, `${slidesHtml}</body>`);
}

const RUNTIME_URL = new URL("./js/slide-runtime.js", location.href).href;
const SYNC_URL = new URL("./js/sync.js", location.href).href;
const HELP_URL = new URL("./js/shortcuts-help.js", location.href).href;
const HELP_CSS = new URL("./css/shortcuts-help.css", location.href).href;

// Screen-mode fallback. !important is used because imported decks often have
// strong rules (e.g. .coral / .center-all chapter dividers) that would
// otherwise win — and we MUST force:
//   - scroll-snap-stop:always — browser actually stops at every slide
//   - scroll-snap-align:start — make every section a snap target
//   - min-height:100vh        — divider slides whose deck CSS collapses them
//   - display:block           — override display:contents / inline
//   - position:relative       — pull absolute/fixed slides back into flow
// If a deck legitimately needs different sizing, append ?nofallback=1 to
// disable this block.
const noFallback = params.get("nofallback") === "1";
const fallbackStyle = noFallback
  ? ""
  : `
<style id="__se_fallback">
  @media screen {
    /* Make <main> the scroll container. Imported v5-style decks expect
       a controller that calls main.style.transform=translateY(-idx*100vh).
       Our runtime uses scrollIntoView() — so we need main to actually
       scroll (overflow-y:auto), to be exactly viewport-tall, and to clear
       any stale translateY left over from the deck CSS. */
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

// Print CSS is always injected (only applies on @media print).
// In ?print=1 mode we additionally apply the same rules on screen so the
// page renders as a vertical stack of full-bleed slides ready for print preview.
const printStyle = `
<style>
  @media print {
    @page { size: 1280px 720px; margin: 0; }
    html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
    html { scroll-snap-type: none !important; scroll-behavior: auto !important; }
    main { display: block !important; }
    .slide {
      width: 1280px !important; height: 720px !important;
      page-break-after: always; page-break-inside: avoid;
      break-after: page; break-inside: avoid;
      scroll-snap-align: none !important;
      overflow: hidden !important;
    }
    .slide:last-child { page-break-after: auto; break-after: auto; }
    .fragment,
    .reveal, .reveal-blur, .reveal-scale {
      opacity: 1 !important; transform: none !important; filter: none !important;
    }
    #__se_progress, #__se_chrome { display: none !important; }
  }
  ${
    isPrint
      ? `
    html { scroll-snap-type: none !important; scroll-behavior: auto !important; height: auto !important; }
    body { overflow: visible !important; }
    main { display: block !important; }
    .slide {
      scroll-snap-align: none !important;
      page-break-after: always; break-after: page;
    }
  `
      : ""
  }
</style>
`;

// Chrome overlay (progress bar + sync indicator) is suppressed in print mode.
const overlay = isPrint
  ? ""
  : `
<div id="__se_progress" style="position:fixed;top:0;left:0;height:2px;width:0;background:#5db8a6;z-index:9999;transition:width .3s ease;"></div>
<div id="__se_chrome" style="position:fixed;top:6px;right:10px;font:11px ui-monospace,monospace;color:#888;letter-spacing:.04em;z-index:9999;text-align:right;line-height:1.5;pointer-events:auto;">
  <div id="__se_counter">— / —</div>
  <div id="__se_sync" style="opacity:.7;cursor:pointer;display:none;"></div>
</div>
`;

// Two different boot scripts: print or interactive.
const printBoot = `
<script>
  document.querySelectorAll(".slide").forEach(el => el.classList.add("visible"));
  document.querySelectorAll(".fragment").forEach(el => el.classList.add("show"));
  document.querySelectorAll(".reveal, .reveal-blur, .reveal-scale")
    .forEach(el => el.classList.add("visible"));
  // Slight delay lets fonts + images settle before the print dialog opens.
  setTimeout(() => { try { window.print(); } catch (e) { console.error(e); } }, 800);
<\/script>
`;

const interactiveBoot = `
<link rel="stylesheet" href="${HELP_CSS}" />
<script type="module">
  import { SlidePresentation } from "${RUNTIME_URL}";
  import { createSlideSync } from "${SYNC_URL}";
  import { bindShortcutsHelp } from "${HELP_URL}";

  bindShortcutsHelp("Present", [
    { keys: ["↓", "→", "PgDn", "Space"], desc: "Next slide / advance fragment" },
    { keys: ["↑", "←", "PgUp"], desc: "Previous slide / hide last fragment" },
    { keys: ["Home"], desc: "Jump to first slide" },
    { keys: ["End"], desc: "Jump to last slide" },
    { keys: ["?"], desc: "This help" },
  ]);

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

  const runtime = new SlidePresentation({
    onSlideChange: ({ index, section_id, total }) => {
      if (counter) counter.textContent = (index + 1) + " / " + total;
      if (progress) progress.style.width = ((index + 1) / Math.max(1, total)) * 100 + "%";
      if (sync) sync.broadcast({ section_id, index });
    },
  });
  if (${startIndex} > 0) runtime.goTo(${startIndex});
<\/script>
`;

const bootScript = isPrint ? printBoot : interactiveBoot;

html = html.replace(
  /<\/body>/i,
  `${fallbackStyle}${printStyle}${overlay}${bootScript}</body>`,
);

if (deck.title && /<title>[^<]*<\/title>/i.test(html)) {
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${deck.title}</title>`);
}

document.open();
document.write(html);
document.close();
