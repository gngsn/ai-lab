// The HTML of a deck document: the deck's own frame with its slides put in,
// plus what Speakeasy adds around it (the read-only note on a plain deck's view
// page, the layout fallback style, and the module that hosts the deck). The
// view and share pages write this into their iframe's document.

import { tagSection } from "../../lib/slide-render";
import { isSlideHiddenContent } from "../../lib/slide-visibility";
import { resolveStorageSourcesInHtml } from "../../lib/storage-src";

export type DeckDocumentInput = {
  deck: { frame_html: string; title?: string | null };
  slides: { section_id: string; content: string }[];
  /** share = the audience page, which follows the presenter and has no overlay. */
  shareMode: boolean;
  followSync: string | null;
  /** ?nofallback=1 */
  noFallback: boolean;
  /** The page's own URL: relative URLs of the scripts it loads are taken from it. */
  base: string;
};

const homeLink = `
<a href="./index.html" target="_top" title="Home" style="position:fixed;top:8px;left:10px;z-index:9999;display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border:1px solid rgba(255,255,255,.14);border-radius:6px;background:rgba(20,20,20,.76);color:#f0f0f0;font:12px ui-monospace,monospace;text-decoration:none;pointer-events:auto;backdrop-filter:blur(8px);">⌂ Home</a>`;
const statusStyle =
  "position:fixed;top:6px;right:10px;font:10px ui-monospace,monospace;color:#888;letter-spacing:.05em;z-index:9999;text-align:right;pointer-events:none;";

// Same layout fallback as the present page — disabled until deck-host picks
// "speakeasy" mode.
export function fallbackStyleHtml(noFallback: boolean): string {
  return noFallback
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
}

/** JSON that is safe inside an inline <script> (no `</script>` break-out). */
const scriptJson = (value: unknown) =>
  JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028|\u2029/g, (c) => (c === "\u2028" ? "\\u2028" : "\\u2029"));

/** Slides the viewer must not see. */
export const visibleSlides = <T extends { content: string }>(slides: T[]) =>
  slides.filter((s) => !isSlideHiddenContent(s.content));

export function buildDeckDocument({
  deck,
  slides,
  shareMode,
  followSync,
  noFallback,
  base,
}: DeckDocumentInput): string {
  const slidesHtml = slides
    .map((s) => resolveStorageSourcesInHtml(tagSection(s.content, s.section_id)))
    .join("\n");

  let html = resolveStorageSourcesInHtml(deck.frame_html);
  if (html.includes("<!-- slides -->")) {
    html = html.replace("<!-- slides -->", () => slidesHtml);
  } else {
    html = html.replace(/<\/body>/i, () => `${slidesHtml}</body>`);
  }

  const url = (path: string) => new URL(path, base).href;
  // Speakeasy's own chrome (Home link, read-only note) starts hidden and is
  // only shown for plain decks ("speakeasy" mode). The audience page's follow
  // control lives outside the slide instead (see view-runtime).
  const overlay = shareMode
    ? ""
    : `<div id="__se_overlay" hidden>${homeLink}
<div style="${statusStyle}">read-only · shared view</div></div>`;

  const bootScript = `
${fallbackStyleHtml(noFallback)}
<script type="module">
  import { startView } from "${url("./js/view-runtime.js")}";
  await startView(${scriptJson({ followSync, helpCss: url("./css/shortcuts-help.css") })});
</script>
`;

  html = html.replace(/<\/body>/i, () => `${overlay}${bootScript}</body>`);

  if (deck.title && /<title>[^<]*<\/title>/i.test(html)) {
    html = html.replace(/<title>[^<]*<\/title>/i, () => `<title>${deck.title}</title>`);
  }
  return html;
}
