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
// Optional live captions (js/captions/) — the page works without them.
const CAPTIONS_URL = new URL("./js/captions/audience.js", location.href).href;

// Speakeasy's own chrome (Home link, read-only note) starts hidden and is
// only shown for plain decks ("speakeasy" mode). The audience page's
// follow control lives outside the slide instead (see FOLLOW_CSS).
const homeLink = `
<a href="./index.html" target="_top" title="Home" style="position:fixed;top:8px;left:10px;z-index:9999;display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:rgba(20,20,20,.76);color:#f0f0f0;font:12px ui-monospace,monospace;text-decoration:none;pointer-events:auto;backdrop-filter:blur(8px);">⌂ Home</a>`;
const statusStyle =
  "position:fixed;top:6px;right:10px;font:10px ui-monospace,monospace;color:#888;letter-spacing:.05em;z-index:9999;text-align:right;pointer-events:none;";
// Audience page: live status + Stop / Follow toggle. It goes in the page
// around the letterboxed slide (js/letterbox.js), not on the slide, so it
// never covers deck content and keeps its size on a phone.
const FOLLOW_CSS = `
#__se_follow {
  position: fixed; top: max(8px, env(safe-area-inset-top)); right: 10px;
  z-index: 10; display: flex; align-items: center; gap: 8px;
  padding: 3px 3px 3px 10px; border: 1px solid rgba(255,255,255,.14);
  border-radius: 999px; background: rgba(20,20,20,.8);
  font: 11px ui-monospace, monospace; letter-spacing: .04em; color: #888;
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
}
#__se_follow button {
  font: inherit; letter-spacing: inherit; color: #f0f0f0; cursor: pointer;
  background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.18);
  border-radius: 999px; padding: 5px 12px;
  display: inline-flex; align-items: center; white-space: nowrap;
  transition: background .2s ease;
}
#__se_follow button:hover { background: rgba(255,255,255,.18); }
/* Hover (or keyboard focus) slides the rest of the label open — "Follow"
   becomes "Follow the presenter". The pill is anchored right, so it grows
   leftward. Touch screens have no hover and keep the short label. */
#__se_follow button .more {
  display: inline-block; overflow: hidden; vertical-align: bottom;
  white-space: pre; /* keep the leading space an inline-block would drop */
  max-width: 0; opacity: 0; transform: translateX(-4px);
  transition: max-width .5s cubic-bezier(.2,.8,.2,1),
    opacity .3s ease, transform .5s cubic-bezier(.2,.8,.2,1);
}
#__se_follow button:hover .more,
#__se_follow button:focus-visible .more {
  max-width: 16em; opacity: 1; transform: none;
  transition-delay: 0s, .12s, 0s;
}
@media (prefers-reduced-motion: reduce) {
  #__se_follow button .more { transition: none; }
}
/* What Stop / Follow just did, shown briefly under the control. */
#__se_follow_hint {
  position: fixed; top: calc(max(8px, env(safe-area-inset-top)) + 42px);
  right: 10px; z-index: 10; max-width: min(280px, calc(100vw - 20px));
  padding: 7px 11px; border-radius: 8px; background: rgba(20,20,20,.88);
  border: 1px solid rgba(255,255,255,.14); color: #e8e8e8;
  font: 12px/1.45 system-ui, sans-serif; pointer-events: none;
  word-break: keep-all; /* Korean: wrap between words, not inside one */
  opacity: 0; transform: translateY(-4px);
  transition: opacity .2s ease, transform .2s ease;
}
#__se_follow_hint.show { opacity: 1; transform: none; }
`;
const overlay = shareMode
  ? ""
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
    // Draw the control in the letterbox page around the slide (same
    // origin); without one (e.g. opened bare), in this document.
    let ui = document;
    try {
      if (window.parent !== window && window.parent.document) ui = window.parent.document;
    } catch {}
    ui.getElementById("__se_follow")?.remove();
    const style = ui.createElement("style");
    style.textContent = ${JSON.stringify(FOLLOW_CSS)};
    // Korean or English, from the browser / system language.
    const ko = /^ko(-|$)/i.test(navigator.languages?.[0] || navigator.language || "");
    const touch = matchMedia("(hover: none) and (pointer: coarse)").matches;
    // The status and button labels stay English; descriptions follow it.
    const labels = {
      live: "● Live", paused: "Paused", offline: "Offline", waiting: "Waiting…",
      // Short label, plus the rest revealed on hover.
      pause: "Pause", pauseMore: " · manual control",
      follow: "Follow", followMore: " the presenter",
    };
    const t = ko
      ? {
          ...labels,
          stopTitle: "발표자 따라가기를 멈추고 직접 넘겨 보기",
          followTitle: "발표자의 현재 슬라이드로 돌아가 따라가기",
          followingHint: "발표자를 따라가요. 발표에 맞춰 슬라이드가 넘어가요.",
          pausedHint: touch
            ? "일시정지했어요. < > 버튼으로 직접 넘겨 보세요. Follow를 누르면 다시 따라가요."
            : "일시정지했어요. ← → 키로 직접 넘겨 보세요. Follow를 누르면 다시 따라가요.",
        }
      : {
          ...labels,
          stopTitle: "Stop following the presenter and browse on your own",
          followTitle: "Jump back to the presenter's slide and follow along",
          followingHint: "Following the presenter — slides change along with the talk.",
          pausedHint: touch
            ? "Paused — browse at your own pace with the < > buttons. Tap Follow to catch up."
            : "Paused — browse at your own pace with the arrow keys. Click Follow to catch up.",
        };
    const box = ui.createElement("div");
    box.id = "__se_follow";
    box.innerHTML =
      '<span id="__se_status"></span>' +
      '<button id="__se_follow_toggle" type="button" aria-pressed="true">' +
      '<span class="lbl"></span><span class="more"></span></button>';
    box.prepend(style);
    ui.getElementById("__se_follow_hint")?.remove();
    const hint = ui.createElement("div");
    hint.id = "__se_follow_hint";
    hint.setAttribute("role", "status");
    ui.body.append(box, hint);
    import("${CAPTIONS_URL}").then((m) => m.mountCaptions({ room: followSync, ui })).catch(() => {});
    let hintTimer = 0;
    const showHint = (text) => {
      hint.textContent = text;
      hint.classList.add("show");
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => hint.classList.remove("show"), 2600);
    };
    const status = box.querySelector("#__se_status");
    const toggle = box.querySelector("#__se_follow_toggle");
    const toggleLbl = toggle.querySelector(".lbl");
    const toggleMore = toggle.querySelector(".more");
    const setStatus = (text, color) => {
      if (!status) return;
      status.textContent = text;
      status.style.color = color;
    };
    // Following: mirror every presenter update. Not following: browse on
    // your own; the latest update is kept so "Follow" jumps right back.
    let following = true;
    let latest = null;
    let online = false;
    const showState = () => {
      if (!following) setStatus(t.paused, "#9a9a9c");
      else if (latest && online) setStatus(t.live, "#ff8d70");
      else if (latest) setStatus(t.offline, "#888");
      else setStatus(t.waiting, "#888");
      // The label shows on hover, so no native tooltip; the description
      // stays as the accessible name.
      toggleLbl.textContent = following ? t.pause : t.follow;
      toggleMore.textContent = following ? t.pauseMore : t.followMore;
      toggle.setAttribute("aria-label", following ? t.stopTitle : t.followTitle);
      toggle.setAttribute("aria-pressed", String(following));
    };
    // Jump to the presenter's slide: section_id first (robust to reordering),
    // index as fallback; then mirror step-by-step reveals on that slide.
    const apply = (payload) => {
      const { section_id, index } = payload;
      let i = host.slides.findIndex((s) => s.dataset.sectionId === section_id);
      if (i < 0 && Number.isInteger(index)) i = index;
      if (i < 0) return;
      host.goTo(i);
      host.applyStepState(payload);
    };
    showState();
    const follow = (payload = {}) => {
      latest = payload;
      online = true;
      if (following) apply(payload);
      showState();
    };
    toggle.addEventListener("click", () => {
      following = !following;
      if (following && latest) apply(latest);
      showState();
      showHint(following ? t.followingHint : t.pausedHint);
      // Hand focus back to the slides so arrow keys keep working.
      toggle.blur();
      window.focus();
    });
    const sync = createSlideSync(followSync, follow, (state) => {
      if (state === "SUBSCRIBED") {
        sync?.requestState(); // late joiner: ask for the current slide
      } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
        online = false;
        showState();
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
// Not on the audience page (share.html): it's mostly opened on phones, where
// holding every file in memory up front risks the tab being killed; media
// loads normally from its URL there.
if (!shareMode) {
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
