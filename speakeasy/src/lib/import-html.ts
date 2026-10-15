// Turning a deck's HTML (and notes Markdown) into slide records (port of
// public/js/import-html.js, same behavior).

function getAttr(attrs: string, name: string) {
  const re = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const m = attrs.match(re);
  return m ? (m[2] ?? m[3] ?? m[4]) : null;
}

export function slugify(s: string | null | undefined) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type Section = { attrs: string; outerHtml: string; start: number; end: number };

function extractSections(html: string): Section[] {
  const sections: Section[] = [];
  const re = /<section\b([^>]*)>([\s\S]*?)<\/section>/gi;
  let m: RegExpExecArray | null = re.exec(html);
  while (m) {
    sections.push({
      attrs: m[1],
      outerHtml: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
    m = re.exec(html);
  }
  return sections;
}

export type ImportedSlide = {
  section_id: string;
  order: number;
  title: string;
  content: string;
};

function buildSlideRecord(section: Section, index: number, seenIds: Set<string>): ImportedSlide {
  const explicit =
    getAttr(section.attrs, "data-section-id") || getAttr(section.attrs, "data-edit-id");
  const title = getAttr(section.attrs, "data-title") || "";
  let id = explicit || slugify(title) || `s-${String(index + 1).padStart(3, "0")}`;
  if (seenIds.has(id)) {
    let n = 2;
    while (seenIds.has(`${id}-${String(n).padStart(2, "0")}`)) n++;
    id = `${id}-${String(n).padStart(2, "0")}`;
  }
  seenIds.add(id);
  return {
    section_id: id,
    order: index,
    title: title || `Slide ${index + 1}`,
    content: section.outerHtml,
  };
}

function buildFrameHtml(html: string, sections: Section[]) {
  if (sections.length === 0) {
    if (html.includes("<!-- slides -->")) return html;
    if (/<\/body>/i.test(html)) {
      return html.replace(/<\/body>/i, "<!-- slides -->\n</body>");
    }
    return `${html}\n<!-- slides -->\n`;
  }
  const head = html.slice(0, sections[0].start);
  const tail = html.slice(sections[sections.length - 1].end);
  return `${head}<!-- slides -->${tail}`;
}

function extractDocTitle(html: string) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : null;
}

export type NotesSection = { title: string | null; body: string };

/** Notes / key-message Markdown: sections split on `---`, optional `## title`. */
export function parseNotesMd(md: unknown): NotesSection[] {
  let body = String(md || "").replace(/^﻿/, "");
  body = body.replace(/^---\s*\n[\s\S]*?\n---\s*\n+/, "");
  const chunks = body.split(/^---+[ \t]*$/m);
  return chunks
    .map((c) => c.trim())
    .filter((c) => c.length > 0)
    .map((chunk) => {
      const lines = chunk.split("\n");
      let title: string | null = null;
      let start = 0;
      const m = lines[0]?.match(/^##\s+(.+)$/);
      if (m) {
        title = m[1].trim();
        start = 1;
        if (lines[start] !== undefined && lines[start].trim() === "") {
          start++;
        }
      }
      return { title, body: lines.slice(start).join("\n").trim() };
    });
}

export function parseImportedHtmlDeck(
  html: string,
  { deckId, title }: { deckId?: string; title?: string } = {},
) {
  const sections = extractSections(html);
  const seen = new Set<string>();
  const slides = sections.map((section, index) => buildSlideRecord(section, index, seen));
  const frameHtml = buildFrameHtml(html, sections);
  const docTitle = extractDocTitle(html);
  const nextTitle = title || docTitle || deckId || "Untitled";

  return {
    deckId: deckId || slugify(docTitle) || "imported-deck",
    title: nextTitle,
    frameHtml,
    slides,
  };
}
