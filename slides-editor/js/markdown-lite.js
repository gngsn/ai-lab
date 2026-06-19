function escapeHtml(text) {
  return String(text || "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

function renderInline(text) {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return html;
}

function renderParagraph(lines) {
  return `<p>${renderInline(lines.join(" "))}</p>`;
}

function renderList(lines, ordered) {
  const items = lines
    .map((line) => line.replace(ordered ? /^\d+\.\s+/ : /^[*+-]\s+/, ""))
    .map((item) => `<li>${renderInline(item)}</li>`)
    .join("");
  return ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
}

function isListLine(line) {
  return /^[*+-]\s+/.test(line) || /^\d+\.\s+/.test(line);
}

export function markdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const out = [];

  let i = 0;
  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line) {
      i++;
      continue;
    }

    if (/^```/.test(line)) {
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      out.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (/^>\s+/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^>\s+/.test(lines[i].trim())) {
        quoteLines.push(lines[i].trim().replace(/^>\s+/, ""));
        i++;
      }
      out.push(`<blockquote>${renderInline(quoteLines.join("<br>"))}</blockquote>`);
      continue;
    }

    if (isListLine(line)) {
      const ordered = /^\d+\.\s+/.test(line);
      const listLines = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        (ordered ? /^\d+\.\s+/.test(lines[i].trim()) : /^[*+-]\s+/.test(lines[i].trim()))
      ) {
        listLines.push(lines[i].trim());
        i++;
      }
      out.push(renderList(listLines, ordered));
      continue;
    }

    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !isListLine(lines[i].trim())) {
      const probe = lines[i].trim();
      if (/^```/.test(probe) || /^(#{1,6})\s+/.test(probe) || /^>\s+/.test(probe)) {
        break;
      }
      paragraph.push(probe);
      i++;
    }
    out.push(renderParagraph(paragraph));
  }

  return out.join("\n");
}
