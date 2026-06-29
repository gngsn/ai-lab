import { describe, it, expect, beforeEach } from 'vitest';
import { createMemoryDb } from '@adapters/memory/memory-db';
import { MemoryDeckStore } from '@adapters/memory/memory-deck-store';
import { MemorySlideStore } from '@adapters/memory/memory-slide-store';
import { MemoryNotesStore } from '@adapters/memory/memory-notes-store';
import { DeckSession } from './deck-session';
import { isSlideHiddenContent } from '@core/slide/slide-visibility';
import type { Ports } from '@ports/ports';

function makePorts() {
  const db = createMemoryDb();
  const ports = {
    deckStore: new MemoryDeckStore(db),
    slideStore: new MemorySlideStore(db),
    notesStore: new MemoryNotesStore(db),
  } as unknown as Ports;
  return ports;
}

async function seededSession(): Promise<DeckSession> {
  const ports = makePorts();
  await ports.deckStore.upsert('u', 'u@e.com', {
    deckId: 'd',
    title: 'D',
    frameHtml: '<main><!-- slides --></main>',
  });
  await ports.slideStore.add('d', {
    sectionId: 's1',
    order: 0,
    title: 'A',
    content: '<section>1</section>',
  });
  await ports.slideStore.add('d', {
    sectionId: 's2',
    order: 1,
    title: 'B',
    content: '<section>2</section>',
  });
  const session = new DeckSession(ports, 'd');
  await session.load();
  return session;
}

describe('DeckSession', () => {
  let session: DeckSession;
  beforeEach(async () => {
    session = await seededSession();
  });

  it('loads slides ordered and selects the first', () => {
    expect(session.slides.map((s) => s.sectionId)).toEqual(['s1', 's2']);
    expect(session.currentSectionId).toBe('s1');
  });

  it('adds a slide and selects it with an empty note', async () => {
    await session.addSlide();
    expect(session.slides).toHaveLength(3);
    expect(session.currentSectionId).toBe(session.slides[2].sectionId);
    expect(session.noteOf(session.currentSectionId)).toBe('');
  });

  it('duplicates a slide right after the source with a (copy) title', async () => {
    await session.duplicateSlide('s1');
    expect(session.slides).toHaveLength(3);
    expect(session.slides[1].title).toBe('A (copy)');
    expect(session.slides[1].content).toBe('<section>1</section>');
  });

  it('toggles hidden on the slide content', async () => {
    await session.toggleHidden('s1');
    expect(isSlideHiddenContent(session.slides[0].content)).toBe(true);
  });

  it('reorders slides', async () => {
    await session.reorder(['s2', 's1']);
    expect(session.slides.map((s) => s.sectionId)).toEqual(['s2', 's1']);
    expect(session.slides.map((s) => s.order)).toEqual([0, 1]);
  });

  it('deletes the current slide and moves selection', async () => {
    await session.deleteSlide('s1');
    expect(session.slides.map((s) => s.sectionId)).toEqual(['s2']);
    expect(session.currentSectionId).toBe('s2');
  });

  it('saves a note into the cache and store', async () => {
    await session.saveNote('s1', 'hello');
    expect(session.noteOf('s1')).toBe('hello');
  });
});
