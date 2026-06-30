/**
 * Frame cleaning for present/view (SPEC §9.5): strip scripts, inline event
 * handlers, and `javascript:` URLs from a full HTML document while preserving
 * structure and styles. Slide content itself is owner-authored and left intact.
 */
export function cleanFrameHtml(frameHtml: string): string {
  const doc = new DOMParser().parseFromString(frameHtml, 'text/html');

  for (const script of doc.querySelectorAll('script')) script.remove();

  for (const node of doc.querySelectorAll('*')) {
    for (const attr of [...node.attributes]) {
      const isHandler = /^on/i.test(attr.name);
      const isJsUrl = /^\s*javascript:/i.test(attr.value);
      if (isHandler || isJsUrl) node.removeAttribute(attr.name);
    }
  }

  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
