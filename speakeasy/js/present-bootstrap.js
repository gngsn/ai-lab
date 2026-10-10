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

if (!(await ensureAuthed())) {
  document.body.innerHTML =
    '<p style="padding:2rem;color:var(--se-bad, #b42318);font-family:monospace">' +
    "Access denied — present is owner-only. Use view.html?token=… for sharing.</p>";
  throw new Error("auth");
}

const params = new URLSearchParams(location.search);
const pathMatch = location.pathname.match(/\/present\/([^/?]+)/);
const deckId = params.get("deck") || pathMatch?.[1];
const isPrint = params.get("print") === "1";
const startSectionId = params.get("section") || params.get("slide");
const liveSyncId = params.get("sync");

function fatal(msg) {
  document.body.innerHTML =
    `<pre style="font:14px monospace;color:var(--se-bad, #b42318);padding:2rem;">` +
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

const cleanFrame = (html) =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");

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

// share.html link for the audience (see the overlay's "copy audience link").
let audienceUrl = null;
if (deck.share_token && liveSyncId) {
  const u = new URL("./share.html", location.href);
  u.search = "";
  u.searchParams.set("deck", deckId);
  u.searchParams.set("token", deck.share_token);
  u.searchParams.set("sync", liveSyncId);
  audienceUrl = u.href;
}

let html = deck.frame_html;
// present.html is owner-only, so the deck's own scripts run as written.
// A deck with its own controller is shown exactly like its plain HTML; plain
// decks get Speakeasy's runtime instead (js/deck-host.js decides).
// Print mode still strips scripts so nothing interferes with printing.
if (isPrint) html = cleanFrame(html);
if (html.includes("<!-- slides -->")) {
  html = html.replace("<!-- slides -->", slidesHtml);
} else {
  console.warn("[present] frame_html missing <!-- slides --> placeholder");
  html = html.replace(/<\/body>/i, `${slidesHtml}</body>`);
}
// Older assets were inserted as supabase://… links; show them as public URLs.
html = resolveStorageSourcesInHtml(html);

const DECK_HOST_URL = new URL("./js/deck-host.js", location.href).href;
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
<style id="__se_fallback" media="not all">
  /* Disabled until js/deck-host.js picks "speakeasy" mode (plain decks). */
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
// Starts hidden: only shown for plain decks ("speakeasy" mode, deck-host.js),
// so decks with their own controller look exactly like their plain HTML.
const overlay = isPrint
  ? ""
  : `
<div id="__se_overlay" hidden>
<div id="__se_progress" style="position:fixed;top:0;left:0;height:2px;width:0;background:#ff8d70;z-index:9999;transition:width .3s ease;"></div>
<div id="__se_chrome" style="position:fixed;top:6px;right:10px;font:11px ui-monospace,monospace;color:#888;letter-spacing:.04em;z-index:9999;text-align:right;line-height:1.5;pointer-events:auto;">
  <div id="__se_counter">— / —</div>
  <div id="__se_sync" style="opacity:.7;cursor:pointer;display:none;"></div>
  <div id="__se_audience" title="Copy a link your audience can open to follow along live" style="opacity:.7;cursor:pointer;display:none;"></div>
</div>
<div id="__se_navdots" aria-label="Slide navigation" style="position:fixed;right:14px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;gap:7px;align-items:center;justify-content:center;z-index:9999;pointer-events:none;opacity:0;transition:opacity .18s ease, transform .18s ease;max-height:min(80vh, 720px);overflow:auto;"></div>
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
<script type="module">
  import { hostDeck } from "${DECK_HOST_URL}";
  import { createSlideSync } from "${SYNC_URL}";
  import { bindShortcutsHelp } from "${HELP_URL}";

  const syncId = new URLSearchParams(location.search).get("sync");
  const initialIndex = ${startIndex};
  const audienceUrl = ${JSON.stringify(audienceUrl)};

  // "deck" mode: the deck runs its own controller and is shown exactly as
  // its plain HTML; Speakeasy only listens. "speakeasy" mode: plain decks
  // get Speakeasy's runtime plus the overlay below. See js/deck-host.js.
  const host = await hostDeck();

  // Live sync (script.html / share.html follow this), in both modes. The
  // last state is re-sent when a follower joins mid-talk and says hello.
  let lastPayload = null;
  let sync = null;
  if (syncId) {
    sync = createSlideSync(syncId, null, null, {
      onHello: () => lastPayload && sync.broadcast(lastPayload),
    });
  }
  host.onChange(({ index, section_id, fragments, stepper }) => {
    lastPayload = { section_id, index, fragments, stepper };
    if (sync) sync.broadcast(lastPayload);
  });

  if (host.mode === "speakeasy") {
    const helpCss = document.createElement("link");
    helpCss.rel = "stylesheet";
    helpCss.href = "${HELP_CSS}";
    document.head.appendChild(helpCss);
    bindShortcutsHelp("Present", [
      { keys: ["↓", "→", "PgDn", "Space"], desc: "Next slide / advance fragment" },
      { keys: ["↑", "←", "PgUp"], desc: "Previous slide / hide last fragment" },
      { keys: ["Home"], desc: "Jump to first slide" },
      { keys: ["End"], desc: "Jump to last slide" },
      { keys: ["?"], desc: "This help" },
    ]);

    document.getElementById("__se_overlay").hidden = false;
    const counter = document.getElementById("__se_counter");
    const syncBadge = document.getElementById("__se_sync");
    const progress = document.getElementById("__se_progress");
    const navDots = document.getElementById("__se_navdots");

    const setNavDotsVisible = (visible) => {
      navDots.style.opacity = visible ? "1" : "0";
      navDots.style.pointerEvents = visible ? "auto" : "none";
      navDots.style.transform = visible ? "translateY(-50%) translateX(0)" : "translateY(-50%) translateX(8px)";
    };
    document.addEventListener("mousemove", (e) => {
      setNavDotsVisible(e.clientX > window.innerWidth * 0.62);
    });
    document.addEventListener("pointerdown", (e) => {
      setNavDotsVisible(e.clientX > window.innerWidth * 0.62);
    });
    setNavDotsVisible(false);

    const dotStyle = document.createElement("style");
    dotStyle.textContent =
      "#__se_navdots button { width: 11px; height: 11px; border-radius: 999px;" +
      " border: 1px solid rgba(255,255,255,.28); background: rgba(255,255,255,.18);" +
      " padding: 0; margin: 0; cursor: pointer; opacity: .8;" +
      " transition: transform .15s ease, background .15s ease, border-color .15s ease, opacity .15s ease; }" +
      "#__se_navdots button:hover { transform: scale(1.18); opacity: 1; border-color: #ff8d70; }" +
      "#__se_navdots button.active { background: #ff8d70; border-color: #ff8d70; opacity: 1; }";
    document.head.appendChild(dotStyle);

    host.slides.forEach((slide, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", "Slide " + (index + 1) + ": " + (slide.dataset.title || ""));
      btn.title = slide.dataset.title || "Slide " + (index + 1);
      btn.addEventListener("click", () => host.goTo(index));
      navDots.appendChild(btn);
    });

    if (syncId && syncBadge) {
      syncBadge.style.display = "block";
      syncBadge.textContent = "● sync: " + syncId;
      syncBadge.onclick = () => navigator.clipboard?.writeText(syncId);
    }
    // Audience link: share.html follows this presentation live. Needs the
    // deck's share token (enable sharing in the editor) and a sync room.
    const audienceEl = document.getElementById("__se_audience");
    if (audienceUrl && audienceEl) {
      audienceEl.style.display = "block";
      audienceEl.textContent = "🔗 copy audience link";
      audienceEl.onclick = async () => {
        try {
          await navigator.clipboard.writeText(audienceUrl);
          audienceEl.textContent = "✓ audience link copied";
        } catch {
          prompt("Audience link", audienceUrl);
        }
        setTimeout(() => (audienceEl.textContent = "🔗 copy audience link"), 2000);
      };
    }

    host.onChange(({ index, total }) => {
      counter.textContent = (index + 1) + " / " + total;
      progress.style.width = ((index + 1) / Math.max(1, total)) * 100 + "%";
      Array.from(navDots.children).forEach((btn, i) => {
        btn.classList.toggle("active", i === index);
        btn.setAttribute("aria-current", i === index ? "true" : "false");
      });
    });
  }

  if (initialIndex > 0) host.goTo(initialIndex);
  lastPayload ||= {
    section_id: host.slides[host.index()]?.dataset.sectionId || null,
    index: host.index(),
    ...host.getStepState(),
  };
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
