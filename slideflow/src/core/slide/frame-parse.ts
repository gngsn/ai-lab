/**
 * Split/reassemble a deck frame into editable HTML / CSS / JS parts (SPEC §9.3
 * frame editor). CSS is the concatenation of all `<style>` blocks; JS is all inline
 * (non-src) `<script>` blocks; HTML is the document with those removed.
 */
export interface FrameParts {
  html: string;
  css: string;
  js: string;
}

const SLIDES_MARKER = '<!-- slides -->';

export function parseFrame(frameHtml: string): FrameParts {
  const doc = new DOMParser().parseFromString(frameHtml, 'text/html');

  const css = [...doc.querySelectorAll('style')]
    .map((s) => s.textContent ?? '')
    .join('\n\n')
    .trim();
  const js = [...doc.querySelectorAll('script')]
    .filter((s) => !s.getAttribute('src'))
    .map((s) => s.textContent ?? '')
    .join('\n\n')
    .trim();

  for (const style of doc.querySelectorAll('style')) style.remove();
  for (const script of doc.querySelectorAll('script')) {
    if (!script.getAttribute('src')) script.remove();
  }

  return { html: `<!doctype html>${doc.documentElement.outerHTML}`, css, js };
}

export function serializeFrame(parts: FrameParts): string {
  const doc = new DOMParser().parseFromString(parts.html, 'text/html');

  if (parts.css.trim()) {
    const style = doc.createElement('style');
    style.textContent = parts.css;
    doc.head.appendChild(style);
  }
  if (parts.js.trim()) {
    const script = doc.createElement('script');
    script.textContent = parts.js;
    doc.body.appendChild(script);
  }

  let html = `<!doctype html>${doc.documentElement.outerHTML}`;
  if (!html.includes(SLIDES_MARKER)) {
    if (/<\/main>/i.test(html)) html = html.replace(/<\/main>/i, `${SLIDES_MARKER}</main>`);
    else if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, `${SLIDES_MARKER}</body>`);
    else html += SLIDES_MARKER;
  }
  return html;
}
