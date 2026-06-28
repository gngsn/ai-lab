import type { Ports } from '@ports/ports';
import type { AuthUser } from '@ports/auth-port';
import { parseDeckHtml } from '@core/import/parse-import';
import { parseNotesMd } from '@core/import/parse-notes';

export interface ImportRequest {
  deckId: string;
  title: string;
  html: string;
  /** Optional Marp notes Markdown, mapped to slides by index. */
  notesMd?: string;
}

/**
 * Create (or replace) a deck from exported HTML, owned by the current user (SPEC §9.2).
 * Sequence: deck upsert → delete existing slides → insert slides → optional notes upsert.
 */
export async function importDeck(ports: Ports, owner: AuthUser, req: ImportRequest): Promise<void> {
  const parsed = parseDeckHtml(req.html);

  await ports.deckStore.upsert(owner.id, owner.email, {
    deckId: req.deckId,
    title: req.title,
    frameHtml: parsed.frameHtml,
  });

  const existing = await ports.slideStore.listByDeck(req.deckId);
  for (const slide of existing) {
    await ports.slideStore.remove(req.deckId, slide.sectionId);
  }

  for (const slide of parsed.slides) {
    await ports.slideStore.add(req.deckId, slide);
  }

  if (req.notesMd) {
    const bodies = parseNotesMd(req.notesMd);
    for (const [index, slide] of parsed.slides.entries()) {
      const body = bodies[index];
      if (body) await ports.notesStore.upsert(req.deckId, slide.sectionId, body);
    }
  }
}
