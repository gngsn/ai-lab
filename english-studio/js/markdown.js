/**
 * markdown.js — small, dependency-free markdown → HTML renderer.
 *
 * Covers exactly what the vocabulary teaching prompt asks the model to
 * produce: headings, bold, horizontal rules, fenced code blocks (used for
 * ASCII diagrams), GFM pipe tables, unordered/ordered lists, and multi-line
 * blockquotes (used for the meaning-chain and for example sentences — a
 * bare ">" is a blank spacer line inside the chain). Not a general-purpose
 * markdown engine — deliberately small.
 *
 * All text is HTML-escaped before any tag is inserted, so model output can
 * never inject markup.
 */

import { escapeHtml } from "./common.js";

function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*(.+?)\*/g, "<em>$1</em>");
  return s;
}

function isTableSep(line) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

export function renderMarkdown(md) {
  const lines = String(md).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let listBuf = null; // { tag: "ul"|"ol", items: [] }

  function flushList() {
    if (!listBuf) return;
    out.push(
      `<${listBuf.tag}>${listBuf.items.map((it) => `<li>${inline(it)}</li>`).join("")}</${listBuf.tag}>`,
    );
    listBuf = null;
  }

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    if (/^```/.test(line)) {
      flushList();
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      out.push(`<pre class="md-diagram">${escapeHtml(buf.join("\n"))}</pre>`);
      continue;
    }

    // Table
    if (line.includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      flushList();
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(
        `<table class="md-table"><thead><tr>${header
          .map((h) => `<th>${inline(h)}</th>`)
          .join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
      continue;
    }

    // Heading
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushList();
      const level = Math.min(h[1].length + 2, 6); // ## -> h4, keep room for page's own h3
      out.push(`<h${level} class="md-h">${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    // Blockquote — consecutive ">" lines group into one block; a bare ">"
    // is a blank spacer line inside a chain (e.g. meaning-development arrows).
    if (/^>/.test(line)) {
      flushList();
      const buf = [];
      while (i < lines.length && /^>/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(
        `<blockquote class="md-quote">${buf
          .map((l) =>
            l.trim() ? `<div>${inline(l)}</div>` : `<div class="md-quote-gap"></div>`,
          )
          .join("")}</blockquote>`,
      );
      continue;
    }

    // Horizontal rule
    if (/^\s*-{3,}\s*$/.test(line) || /^\s*\*{3,}\s*$/.test(line)) {
      flushList();
      out.push(`<hr class="md-hr" />`);
      i++;
      continue;
    }

    // List item
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    const ol = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ul || ol) {
      const tag = ul ? "ul" : "ol";
      const text = (ul || ol)[1];
      if (listBuf && listBuf.tag !== tag) flushList();
      if (!listBuf) listBuf = { tag, items: [] };
      listBuf.items.push(text);
      i++;
      continue;
    }
    if (listBuf && line.trim() === "") {
      flushList();
    }

    // Blank line
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Paragraph: accumulate contiguous non-blank, non-special lines
    flushList();
    const para = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i]) &&
      !/^(#{1,4})\s+/.test(lines[i]) &&
      !/^>/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isTableSep(lines[i + 1]))
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  flushList();
  return out.join("\n");
}
