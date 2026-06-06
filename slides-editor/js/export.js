// Export helpers — HTML / PDF (browser print) / Marp Markdown.
// All exports are pure read-side operations: they fetch from repos and
// either trigger a download, copy to clipboard, or open a print window.
import * as deckRepo from "./repo/deck-repo.js";
import * as notesRepo from "./repo/notes-repo.js";
import * as slideRepo from "./repo/slide-repo.js";

const slugify = (s) =>
  (s || "deck")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "deck";

function downloadBlob(filename, mime, content) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Strip editor-only attributes so the exported HTML is a clean self-contained
// presentation file. `data-edit-id` is removed for share cleanliness; the
// stable-id system only matters during editing.
function stripEditAttrs(html) {
  return html
    .replace(/\s+contenteditable=("true"|true|"")/gi, "")
    .replace(/\s+data-editable=("true"|true)/gi, "")
    .replace(/\s+data-edit-id="[^"]*"/gi, "")
    .replace(/\s+data-section-id="[^"]*"/gi, "");
}

// ── HTML ──────────────────────────────────────────────────────────

export async function buildHtml(deckId) {
  const [deck, slides] = await Promise.all([
    deckRepo.getDeck(deckId),
    slideRepo.listByDeck(deckId),
  ]);
  let slidesHtml = slides.map((s) => s.content).join("\n");
  slidesHtml = stripEditAttrs(slidesHtml);

  let html = deck.frame_html;
  if (html.includes("<!-- slides -->")) {
    html = html.replace("<!-- slides -->", slidesHtml);
  } else {
    html = html.replace(/<\/body>/i, `${slidesHtml}</body>`);
  }
  if (!/^\s*<!doctype/i.test(html)) {
    html = "<!DOCTYPE html>\n" + html;
  }
  return { deck, slides, content: html };
}

export async function exportHtml(deckId) {
  const { deck, content } = await buildHtml(deckId);
  const filename = `${slugify(deck.title)}.html`;
  downloadBlob(filename, "text/html;charset=utf-8", content);
  return { filename, bytes: content.length };
}

// ── PDF (browser print) ───────────────────────────────────────────

export function exportPdf(deckId) {
  const url = `./present.html?deck=${encodeURIComponent(deckId)}&print=1`;
  const w = window.open(url, "_blank");
  if (!w) throw new Error("Popup blocked — allow popups for this site.");
  return { url };
}

// ── Marp notes ────────────────────────────────────────────────────

export async function buildNotesMd(deckId) {
  const [deck, slides, notes] = await Promise.all([
    deckRepo.getDeck(deckId),
    slideRepo.listByDeck(deckId),
    notesRepo.listByDeck(deckId),
  ]);
  const notesByKey = new Map(notes.map((n) => [n.section_id, n.content]));
  const frontmatter = "---\nmarp: true\ntheme: default\n---\n\n";
  const body = slides
    .map((s, i) => {
      const title = s.title || `장표 ${i + 1}`;
      const noteBody = (notesByKey.get(s.section_id) || "").trim();
      // Always leave a blank line under the heading so marp parses cleanly,
      // even when the note body is empty.
      return `## ${title}\n\n${noteBody}\n`;
    })
    .join("\n---\n\n");
  return {
    deck,
    slides,
    notes,
    content: frontmatter + body + "\n",
  };
}

export async function exportNotesMd(deckId, { copy = false } = {}) {
  const { deck, content } = await buildNotesMd(deckId);
  if (copy) {
    if (!navigator.clipboard?.writeText) {
      throw new Error("Clipboard API unavailable in this browser.");
    }
    await navigator.clipboard.writeText(content);
    return { copied: true, length: content.length };
  }
  const filename = `${slugify(deck.title)}-notes.md`;
  downloadBlob(filename, "text/markdown;charset=utf-8", content);
  return { filename, bytes: content.length };
}

// ── PPTX (via pptxgenjs CDN) ───────────────────────────────────────

function getPptxGenJS() {
  const ctor = window.PptxGenJS;
  if (!ctor)
    throw new Error(
      "pptxgenjs가 로드되지 않았습니다. 페이지를 새로고침 해주세요.",
    );
  return ctor;
}

// Convert a CSS color string to a 6-char hex that pptxgenjs accepts.
// Returns null when conversion isn't possible (complex values like gradients).
function toCssHex(color) {
  if (!color) return null;
  const trimmed = color.trim();
  const hex = trimmed.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    const h = hex[1];
    if (h.length === 3)
      return h
        .split("")
        .map((c) => c + c)
        .join("");
    return h.slice(0, 6);
  }
  const rgb = trimmed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    return [rgb[1], rgb[2], rgb[3]]
      .map((n) => Number(n).toString(16).padStart(2, "0"))
      .join("");
  }
  return null;
}

// Extract a CSS property value from an inline style string.
function styleVal(styleAttr, prop) {
  const re = new RegExp(
    `(?:^|;)\\s*${prop.replace("-", "\\-")}\\s*:\\s*([^;]+)`,
    "i",
  );
  const m = (styleAttr ?? "").match(re);
  return m ? m[1].trim() : null;
}

// Parse font-size CSS value → pt number (pptxgenjs uses pt).
function parseFontSizePt(val) {
  if (!val) return null;
  const px = val.match(/^([\d.]+)px$/i);
  if (px) return Math.round(Number(px[1]) * 0.75); // 1px ≈ 0.75pt
  const pt = val.match(/^([\d.]+)pt$/i);
  if (pt) return Math.round(Number(pt[1]));
  const em = val.match(/^([\d.]+)em$/i);
  if (em) return Math.round(Number(em[1]) * 12); // 1em ≈ 12pt base
  const rem = val.match(/^([\d.]+)rem$/i);
  if (rem) return Math.round(Number(rem[1]) * 12);
  return null;
}

// Parse a slide's <section> HTML using the full frame context so that
// CSS custom properties / inherited colors are respected.
// Returns { background, textColor, elements }
// elements: [{ tag, text, color, fontSize, bold, italic, x, y, w, h }]
function extractSlideContent(sectionHtml, frameHtml) {
  // Build a full document from the frame so CSS vars are resolvable
  let fullHtml = frameHtml || "";
  if (fullHtml.includes("<!-- slides -->")) {
    fullHtml = fullHtml.replace("<!-- slides -->", sectionHtml);
  } else {
    fullHtml = fullHtml.replace(/<\/body>/i, `${sectionHtml}</body>`);
  }

  const doc = new DOMParser().parseFromString(fullHtml, "text/html");
  const section =
    doc.querySelector("section.slide") ??
    doc.querySelector("section") ??
    doc.body;

  // ── Background ────────────────────────────────────────────────────
  const sStyle = section.getAttribute("style") ?? "";
  let bgHex =
    toCssHex(styleVal(sStyle, "background-color")) ??
    toCssHex(styleVal(sStyle, "background"));

  // Fallback: grab body background from frame CSS (first --bg / background rule)
  if (!bgHex) {
    const styleEls = [...doc.querySelectorAll("style")];
    for (const st of styleEls) {
      const bodyBg = st.textContent.match(
        /body\s*\{[^}]*background(?:-color)?\s*:\s*([^;}\n]+)/i,
      );
      if (bodyBg) {
        bgHex = toCssHex(bodyBg[1].trim());
        if (bgHex) break;
      }
    }
  }
  bgHex = bgHex ?? "0d0d0d";

  // ── Text color fallback from frame CSS / body ────────────────────
  let defaultTextHex = "f0f0f0";
  const styleEls = [...doc.querySelectorAll("style")];
  for (const st of styleEls) {
    const bodyColor = st.textContent.match(
      /body\s*\{[^}]*(?:^|[;\s])color\s*:\s*([^;}\n]+)/i,
    );
    if (bodyColor) {
      const c = toCssHex(bodyColor[1].trim());
      if (c) {
        defaultTextHex = c;
        break;
      }
    }
  }

  // ── Extract text elements in document order ───────────────────────
  const elements = [];
  const seen = new Set();

  section.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,span,div").forEach((el) => {
    // Skip containers that only wrap other block elements
    const directText = [...el.childNodes]
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(" ")
      .trim();
    const blockText = el.textContent.trim();
    if (!blockText) return;
    // Skip if already captured via a parent
    if ([...seen].some((s) => s.contains(el))) return;

    const tag = el.tagName.toLowerCase();
    const isHeading = /^h[1-6]$/.test(tag);
    const elStyle = el.getAttribute("style") ?? "";

    // Color: inline style → CSS class (heuristic) → default
    let colorHex = toCssHex(styleVal(elStyle, "color")) ?? null;
    if (!colorHex) {
      // Check for common utility class patterns like text-white, color-accent
      const cls = el.className ?? "";
      if (/text-white|color-white/.test(cls)) colorHex = "ffffff";
      else if (/text-dark|color-dark/.test(cls)) colorHex = "111111";
    }
    colorHex = colorHex ?? defaultTextHex;

    // Font size: inline style first, then tag default
    let fontSize =
      parseFontSizePt(styleVal(elStyle, "font-size")) ??
      (isHeading
        ? ({ h1: 40, h2: 32, h3: 26, h4: 22, h5: 18, h6: 16 }[tag] ?? 20)
        : 16);

    const bold =
      isHeading ||
      /bold|700|800|900/.test(styleVal(elStyle, "font-weight") ?? "");
    const italic = /italic/.test(styleVal(elStyle, "font-style") ?? "");

    elements.push({
      tag,
      text: blockText,
      color: colorHex,
      fontSize,
      bold,
      italic,
    });
    seen.add(el);
  });

  return { bgHex, elements };
}

// Layout elements into PPTX text boxes.
// Strategy: first heading → title area (top), rest → body area (stacked).
function layoutElements(pSlide, elements) {
  const headings = elements.filter((e) => /^h[1-6]$/.test(e.tag));
  const body = elements.filter((e) => !/^h[1-6]$/.test(e.tag));

  const titleEl = headings[0];
  const subElements = [...headings.slice(1), ...body];

  if (titleEl) {
    pSlide.addText(titleEl.text, {
      x: 0.4,
      y: 0.5,
      w: 9.2,
      h: 1.6,
      fontSize: Math.min(titleEl.fontSize, 44),
      bold: true,
      color: titleEl.color,
      fontFace: "Arial",
      wrap: true,
      valign: "middle",
    });
  }

  if (subElements.length) {
    const lines = subElements.map((e) => ({
      text: e.text,
      options: {
        fontSize: Math.min(e.fontSize, 28),
        bold: e.bold,
        italic: e.italic,
        color: e.color,
        breakLine: true,
      },
    }));
    pSlide.addText(lines, {
      x: 0.4,
      y: titleEl ? 2.3 : 0.5,
      w: 9.2,
      h: titleEl ? 3.0 : 5.0,
      fontFace: "Arial",
      valign: "top",
      wrap: true,
    });
  }

  // If no elements at all, nothing to add
}

export async function exportPptx(deckId) {
  const PptxGenJS = getPptxGenJS();
  const [deck, slides] = await Promise.all([
    deckRepo.getDeck(deckId),
    slideRepo.listByDeck(deckId),
  ]);

  // eslint-disable-next-line new-cap
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.title = deck.title || "Presentation";
  pptx.author = "slides-editor";

  const frameHtml = deck.frame_html ?? "";

  for (const slide of slides) {
    const { bgHex, elements } = extractSlideContent(slide.content, frameHtml);
    const pSlide = pptx.addSlide();
    pSlide.background = { color: bgHex };
    layoutElements(pSlide, elements);
  }

  const filename = `${slugify(deck.title)}.pptx`;
  const buffer = await pptx.write({ outputType: "arraybuffer" });
  downloadBlob(
    filename,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer,
  );
  return { filename };
}
