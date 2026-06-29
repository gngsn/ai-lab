/** Hidden-slide helpers operating on a slide's first `<section>` (SPEC §10.3). */

const HIDDEN_VALUES = new Set(['', 'true', '1', 'yes']);

/** True when the first section is marked hidden (empty `data-hidden` counts as hidden). */
export function isSlideHiddenContent(content: string): boolean {
  const tag = content.match(/<section\b[^>]*>/i)?.[0] ?? '';
  const valued = tag.match(/\bdata-hidden\s*=\s*"([^"]*)"/i);
  if (valued) return HIDDEN_VALUES.has(valued[1].trim().toLowerCase());
  return /\bdata-hidden\b(?!\s*=)/i.test(tag); // bare `data-hidden`
}

/** Set or clear `data-hidden="true"` on the first section. */
export function setSlideHiddenContent(content: string, hidden: boolean): string {
  return content.replace(/<section\b([^>]*)>/i, (_full, rawAttrs: string) => {
    const attrs = rawAttrs.replace(/\s*\bdata-hidden(\s*=\s*"[^"]*")?/i, '');
    return `<section${attrs}${hidden ? ' data-hidden="true"' : ''}>`;
  });
}
