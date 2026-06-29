/**
 * Minimal, safe Markdown → HTML for notes previews (SPEC §9.7): headings,
 * paragraphs, ul/ol, blockquote, fenced + inline code, bold, italic, http(s) links.
 * Input is HTML-escaped first, so output is safe to inject.
 */
export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i += 1; // closing fence
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]))
        quote.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`);
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      i = appendList(lines, i, out, 'ul', /^\s*[-*]\s+/);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      i = appendList(lines, i, out, 'ol', /^\s*\d+\.\s+/);
      continue;
    }

    if (line.trim() === '') {
      i += 1;
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i]))
      para.push(lines[i++]);
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }

  return out.join('\n');
}

function appendList(
  lines: string[],
  start: number,
  out: string[],
  tag: string,
  re: RegExp,
): number {
  const items: string[] = [];
  let i = start;
  while (i < lines.length && re.test(lines[i])) items.push(inline(lines[i++].replace(re, '')));
  out.push(`<${tag}>${items.map((it) => `<li>${it}</li>`).join('')}</${tag}>`);
  return i;
}

function isBlockStart(line: string): boolean {
  return (
    line.startsWith('```') ||
    /^#{1,6}\s/.test(line) ||
    /^>\s?/.test(line) ||
    /^\s*[-*]\s+/.test(line) ||
    /^\s*\d+\.\s+/.test(line)
  );
}

/** Inline spans on already-block-split text. Escapes first, then applies markup. */
function inline(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener">$1</a>',
  );
  return html;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] as string,
  );
}
