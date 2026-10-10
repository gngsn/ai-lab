// Public viewer — validates ?token= against deck.share_token, then shows
// the deck exactly like present.html (its own HTML, CSS and scripts; see
// js/deck-host.js). share.html is this view following the presenter live.
//
// Tier 1 protection: anyone with `deck_id + token` can read the slides.
// Notes are never fetched. No edit UI, no sync broadcast.
//
// Tier 2 (future): proper RLS that scopes anon access by share_token at the
// database layer so a leaked anon key alone can't pull all decks.

import { getDeck } from "./repo/deck-repo.js";
import {
  applyAssetMap,
  collectAssetUrls,
  formatBytes,
  preloadAssets,
} from "./preload-assets.js";
import { listByDeck } from "./repo/slide-repo.js";
import { tagSection } from "./slide-render.js";
import { isSlideHiddenContent } from "./slide-visibility.js";
import { resolveStorageSourcesInHtml } from "./storage-src.js";

const params = new URLSearchParams(location.search);
const deckId = params.get("deck");
const token = params.get("token");
// share.html sets __SE_SHARE: the same read-only view, but it follows the
// presenter live over the ?sync=<room> channel that present.html broadcasts.
const shareMode = Boolean(window.__SE_SHARE);
const followSync = shareMode ? params.get("sync") : null;

function fatal(msg) {
  document.body.innerHTML =
    `<pre style="font:14px monospace;color:var(--se-bad, #b42318);padding:2rem;max-width:520px;margin:8vh auto;">` +
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

if (shareMode && !followSync) {
  fatal(
    "Missing ?sync=<room>. Open the audience link from present mode " +
      "(\"copy audience link\").",
  );
}

let slides;
try {
  slides = await listByDeck(deckId);
} catch (err) {
  fatal(`Cannot load slides: ${err.message}`);
}

// view.html / share.html show the deck exactly like present.html: the
// deck's own HTML, CSS and scripts as written (a deck with its own
// controller looks exactly like its plain HTML — see js/deck-host.js),
// minus slides hidden in the editor. Earlier versions sanitized the deck
// here, which also stripped its own effects; deck content comes from the
// deck owner, as in present.
slides = slides.filter((s) => !isSlideHiddenContent(s.content));

if (slides.length === 0) {
  fatal(`Deck '${deckId}' has no slides.`);
}

const slidesHtml = slides
  .map((s) => resolveStorageSourcesInHtml(tagSection(s.content, s.section_id)))
  .join("\n");

let html = resolveStorageSourcesInHtml(deck.frame_html);
if (html.includes("<!-- slides -->")) {
  html = html.replace("<!-- slides -->", slidesHtml);
} else {
  html = html.replace(/<\/body>/i, `${slidesHtml}</body>`);
}

const DECK_HOST_URL = new URL("./js/deck-host.js", location.href).href;
const SYNC_URL = new URL("./js/sync.js", location.href).href;
const HELP_URL = new URL("./js/shortcuts-help.js", location.href).href;
const HELP_CSS = new URL("./css/shortcuts-help.css", location.href).href;

// Speakeasy's own chrome (Home link, read-only note) starts hidden and is
// only shown for plain decks ("speakeasy" mode). The audience page keeps
// its small live-follow status in both modes.
const homeLink = `
<a href="./index.html" target="_top" title="Home" style="position:fixed;top:8px;left:10px;z-index:9999;display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:rgba(20,20,20,.76);color:#f0f0f0;font:12px ui-monospace,monospace;text-decoration:none;pointer-events:auto;backdrop-filter:blur(8px);">⌂ Home</a>`;
const statusStyle =
  "position:fixed;top:6px;right:10px;font:10px ui-monospace,monospace;color:#888;letter-spacing:.05em;z-index:9999;text-align:right;pointer-events:none;";
const overlay = shareMode
  ? `<div id="__se_status" style="${statusStyle}">waiting for presenter…</div>`
  : `<div id="__se_overlay" hidden>${homeLink}
<div style="${statusStyle}">read-only · shared view</div></div>`;

// Same layout fallback as present-bootstrap — disabled until deck-host
// picks "speakeasy" mode.
const noFallback =
  new URLSearchParams(location.search).get("nofallback") === "1";
const fallbackStyle = noFallback
  ? ""
  : `
<style id="__se_fallback" media="not all">
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
<script type="module">
  import { hostDeck } from "${DECK_HOST_URL}";
  import { bindShortcutsHelp } from "${HELP_URL}";
  const host = await hostDeck();
  if (host.mode === "speakeasy") {
    const overlay = document.getElementById("__se_overlay");
    if (overlay) overlay.hidden = false;
    const helpCss = document.createElement("link");
    helpCss.rel = "stylesheet";
    helpCss.href = "${HELP_CSS}";
    document.head.appendChild(helpCss);
    bindShortcutsHelp("View (shared)", [
      { keys: ["↓", "→", "PgDn", "Space"], desc: "Next slide / advance fragment" },
      { keys: ["↑", "←", "PgUp"], desc: "Previous slide / hide last fragment" },
      { keys: ["Home", "End"], desc: "Jump to first / last slide" },
      { keys: ["?"], desc: "This help" },
    ]);
  }
  const followSync = ${JSON.stringify(followSync)};
  if (followSync) {
    const { createSlideSync } = await import("${SYNC_URL}");
    const status = document.getElementById("__se_status");
    const setStatus = (text, color) => {
      if (!status) return;
      status.textContent = text;
      status.style.color = color;
    };
    // Jump to the presenter's slide: section_id first (robust to reordering),
    // index as fallback; then mirror step-by-step reveals on that slide.
    const follow = (payload = {}) => {
      const { section_id, index } = payload;
      let i = host.slides.findIndex((s) => s.dataset.sectionId === section_id);
      if (i < 0 && Number.isInteger(index)) i = index;
      if (i < 0) return;
      host.goTo(i);
      host.applyStepState(payload);
      setStatus("● live · following presenter", "#ff8d70");
    };
    const sync = createSlideSync(followSync, follow, (state) => {
      if (state === "SUBSCRIBED") {
        sync?.requestState(); // late joiner: ask for the current slide
      } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
        setStatus("offline · reconnecting…", "#888");
      }
    });
  }
<\/script>
`;

html = html.replace(/<\/body>/i, `${overlay}${bootScript}</body>`);

if (deck.title && /<title>[^<]*<\/title>/i.test(html)) {
  html = html.replace(/<title>[^<]*<\/title>/i, `<title>${deck.title}</title>`);
}

// Download every image/video/audio the deck uses before showing it, and
// point the deck at the local copies — no network needed between slides.
{
  const assetUrls = collectAssetUrls(html);
  if (assetUrls.length) {
    const label = document.querySelector("body > p");
    const map = await preloadAssets(assetUrls, {
      onProgress: ({ done, total, bytes }) => {
        if (label) {
          label.textContent = `loading assets ${done}/${total} · ${formatBytes(bytes)}`;
        }
      },
    });
    html = applyAssetMap(html, map);
  }
}

document.open();
document.write(html);
document.close();
