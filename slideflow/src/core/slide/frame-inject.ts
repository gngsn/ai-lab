const SLIDES_MARKER = '<!-- slides -->';

/**
 * Inject joined slide HTML into a deck frame (SPEC §5.2): replace the
 * `<!-- slides -->` marker, else insert before `</body>`, else append.
 */
export function injectSlides(frameHtml: string, slidesHtml: string): string {
  if (frameHtml.includes(SLIDES_MARKER)) {
    return frameHtml.replace(SLIDES_MARKER, slidesHtml);
  }
  if (/<\/body>/i.test(frameHtml)) {
    return frameHtml.replace(/<\/body>/i, `${slidesHtml}</body>`);
  }
  return frameHtml + slidesHtml;
}
