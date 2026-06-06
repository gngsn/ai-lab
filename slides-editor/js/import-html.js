function getAttr(attrs, name) {
  const re = new RegExp(
    `\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const m = attrs.match(re);
  return m ? (m[2] ?? m[3] ?? m[4]) : null;
}

export function slugify(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extractSections(html) {
  const sections = [];
  const re = /<section\b([^>]*)>([\s\S]*?)<\/section>/gi;
  let m;
  while ((m = re.exec(html))) {
    sections.push({
      attrs: m[1],
      outerHtml: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return sections;
}

function buildSlideRecord(section, index, seenIds) {
  const explicit =
    getAttr(section.attrs, "data-section-id") ||
    getAttr(section.attrs, "data-edit-id");
  const title = getAttr(section.attrs, "data-title") || "";
  let id =
    explicit || slugify(title) || `s-${String(index + 1).padStart(3, "0")}`;
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

function buildFrameHtml(html, sections) {
  if (sections.length === 0) {
    if (html.includes("<!-- slides -->")) return html;
    if (/<\/body>/i.test(html)) {
      return html.replace(/<\/body>/i, "<!-- slides -->\n</body>");
    }
    return `${html}\n<!-- slides -->\n`;
  }
  const head = html.slice(0, sections[0].start);
  const tail = html.slice(sections[sections.length - 1].end);
  return head + "<!-- slides -->" + tail;
}

function extractDocTitle(html) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : null;
}

export function parseImportedHtmlDeck(html, { deckId, title } = {}) {
  const sections = extractSections(html);
  const seen = new Set();
  const slides = sections.map((section, index) =>
    buildSlideRecord(section, index, seen),
  );
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
