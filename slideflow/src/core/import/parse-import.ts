import { slugify } from '@core/text/slugify';
import { dedupeSectionId } from '@core/text/section-id';

export interface ParsedSlide {
  sectionId: string;
  title: string;
  content: string;
  order: number;
}

export interface ParsedDeck {
  /** Frame HTML with a `<!-- slides -->` marker where the sections were. */
  frameHtml: string;
  slides: ParsedSlide[];
}

const SECTION_RE = /<section\b[^>]*>[\s\S]*?<\/section>/gi;
const SLIDES_MARKER = '<!-- slides -->';

/**
 * Split an exported deck HTML into a reusable frame + ordered slides (SPEC §9.2).
 * Section id priority: data-section-id, data-edit-id, slugified data-title, else `s-NNN`.
 */
export function parseDeckHtml(html: string): ParsedDeck {
  const matches = [...html.matchAll(SECTION_RE)];
  if (matches.length === 0) {
    return { frameHtml: `${html}${SLIDES_MARKER}`, slides: [] };
  }

  const taken = new Set<string>();
  const slides = matches.map((match, index) => {
    const content = match[0];
    const openTag = content.match(/<section\b[^>]*>/i)?.[0] ?? '';
    const sectionId = dedupeSectionId(resolveSectionId(openTag, index), taken);
    taken.add(sectionId);
    return {
      sectionId,
      title: attr(openTag, 'data-title') ?? `Slide ${index + 1}`,
      content,
      order: index,
    };
  });

  const first = matches[0];
  const last = matches[matches.length - 1];
  const before = html.slice(0, first.index);
  const after = html.slice(last.index + last[0].length);
  return { frameHtml: `${before}${SLIDES_MARKER}${after}`, slides };
}

function resolveSectionId(openTag: string, index: number): string {
  const fromData = attr(openTag, 'data-section-id') ?? attr(openTag, 'data-edit-id');
  if (fromData) return fromData;
  const title = attr(openTag, 'data-title');
  if (title) {
    const slug = slugify(title);
    if (slug !== 'untitled') return slug;
  }
  return `s-${String(index + 1).padStart(3, '0')}`;
}

function attr(openTag: string, name: string): string | null {
  const match = openTag.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return match ? match[1] : null;
}
