// The HTML of the presenter page's deck document: the deck's own frame with
// its slides put in, plus what Speakeasy adds (layout fallback, print style,
// the overlay of a plain deck and the module that hosts the deck). The page
// writes this into its iframe's document — or into the page itself in
// ?print=1 mode.

import { scriptJson } from "../../lib/script-json";
import { tagSection } from "../../lib/slide-render";
import { isSlideHiddenContent } from "../../lib/slide-visibility";
import { resolveStorageSourcesInHtml } from "../../lib/storage-src";
import { fallbackStyleHtml } from "../view/document";

type Slide = { section_id: string; content: string };

export type PresentDocumentInput = {
  deck: { frame_html: string; title?: string | null };
  /** Every slide of the deck, hidden ones included (they only matter for the start slide). */
  slides: Slide[];
  isPrint: boolean;
  noFallback: boolean;
  /** Index among the visible slides to open on. */
  startIndex: number;
  audienceUrl: string | null;
  /** The page's own URL: relative URLs of the scripts it loads are taken from it. */
  base: string;
};

/** Slides the presenter shows, each with its place in the full list. */
export const visibleWithIndex = <T extends { content: string }>(slides: T[]) =>
  slides
    .map((slide, index) => ({ slide, index }))
    .filter(({ slide }) => !isSlideHiddenContent(slide.content));

/** The visible slide to open on for ?section=: an exact match, else the next
 *  visible one after a hidden section, else the last one before it, else the first. */
export function resolveStartIndex(
  all: { section_id: string }[],
  visible: { slide: { section_id: string }; index: number }[],
  startSectionId: string | null,
): number {
  if (!startSectionId) return 0;
  const exact = visible.findIndex(({ slide }) => slide.section_id === startSectionId);
  if (exact !== -1) return exact;

  const targetFullIndex = all.findIndex((slide) => slide.section_id === startSectionId);
  if (targetFullIndex === -1) return 0;

  const forward = visible.findIndex(({ index }) => index >= targetFullIndex);
  if (forward !== -1) return forward;

  for (let i = visible.length - 1; i >= 0; i--) {
    if (visible[i].index < targetFullIndex) return i;
  }
  return 0;
}

/** The share.html link for the audience, or null without a share token and a sync room. */
export function audienceLink(
  base: string,
  deckId: string,
  shareToken: string | null | undefined,
  syncId: string | null,
): string | null {
  if (!shareToken || !syncId) return null;
  const u = new URL("./share.html", base);
  u.search = "";
  u.searchParams.set("deck", deckId);
  u.searchParams.set("token", shareToken);
  u.searchParams.set("sync", syncId);
  return u.href;
}

// Print mode strips the deck's own scripts so nothing interferes with printing.
export const cleanFrame = (html: string) =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<script\b[^>]*\/\s*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/javascript:/gi, "");

// Print CSS is always injected (only applies on @media print). In ?print=1
// mode the same rules also apply on screen so the page renders as a vertical
// stack of full-bleed slides ready for print preview.
const printStyle = (isPrint: boolean) => `
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
// Starts hidden: only shown for plain decks ("speakeasy" mode), so decks with
// their own controller look exactly like their plain HTML.
const overlayHtml = `
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

const printBoot = `
<script>
  document.querySelectorAll(".slide").forEach(el => el.classList.add("visible"));
  document.querySelectorAll(".fragment").forEach(el => el.classList.add("show"));
  document.querySelectorAll(".reveal, .reveal-blur, .reveal-scale")
    .forEach(el => el.classList.add("visible"));
  // Slight delay lets fonts + images settle before the print dialog opens.
  setTimeout(() => { try { window.print(); } catch (e) { console.error(e); } }, 800);
</script>
`;

export function buildPresentDocument({
  deck,
  slides,
  isPrint,
  noFallback,
  startIndex,
  audienceUrl,
  base,
}: PresentDocumentInput): string {
  const slidesHtml = visibleWithIndex(slides)
    .map(({ slide }) => tagSection(slide.content, slide.section_id))
    .join("\n");

  let html = deck.frame_html;
  // The presenter page is owner-only, so the deck's own scripts run as
  // written. A deck with its own controller is shown exactly like its plain
  // HTML; plain decks get Speakeasy's runtime instead (deck-host decides).
  if (isPrint) html = cleanFrame(html);
  if (html.includes("<!-- slides -->")) {
    html = html.replace("<!-- slides -->", () => slidesHtml);
  } else {
    console.warn("[present] frame_html missing <!-- slides --> placeholder");
    html = html.replace(/<\/body>/i, () => `${slidesHtml}</body>`);
  }
  // Older assets were inserted as supabase://… links; show them as public URLs.
  html = resolveStorageSourcesInHtml(html);

  const url = (path: string) => new URL(path, base).href;
  const interactiveBoot = `
<script type="module">
  import { startPresent } from "${url("./js/present-runtime.js")}";
  await startPresent(${scriptJson({
    initialIndex: startIndex,
    audienceUrl,
    helpCss: url("./css/shortcuts-help.css"),
  })});
</script>
`;
  const bootScript = isPrint ? printBoot : interactiveBoot;
  const overlay = isPrint ? "" : overlayHtml;

  html = html.replace(
    /<\/body>/i,
    () => `${fallbackStyleHtml(noFallback)}${printStyle(isPrint)}${overlay}${bootScript}</body>`,
  );

  if (deck.title && /<title>[^<]*<\/title>/i.test(html)) {
    html = html.replace(/<title>[^<]*<\/title>/i, () => `<title>${deck.title}</title>`);
  }
  return html;
}
