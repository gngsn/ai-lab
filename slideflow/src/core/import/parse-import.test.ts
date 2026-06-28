import { describe, it, expect } from 'vitest';
import { parseDeckHtml } from './parse-import';
import { parseNotesMd } from './parse-notes';

describe('parseDeckHtml', () => {
  it('extracts sections, builds a frame with the slides marker', () => {
    const html =
      '<html><body><main>' +
      '<section data-title="Intro"><h1>Intro</h1></section>' +
      '<section data-title="Next"><h1>Next</h1></section>' +
      '</main></body></html>';
    const parsed = parseDeckHtml(html);

    expect(parsed.slides.map((s) => s.sectionId)).toEqual(['intro', 'next']);
    expect(parsed.slides.map((s) => s.title)).toEqual(['Intro', 'Next']);
    expect(parsed.slides.map((s) => s.order)).toEqual([0, 1]);
    expect(parsed.frameHtml).toContain('<!-- slides -->');
    expect(parsed.frameHtml).not.toContain('<section');
  });

  it('prefers data-section-id and dedupes collisions', () => {
    const html =
      '<section data-section-id="a"><p>1</p></section>' +
      '<section data-title="A"><p>2</p></section>' +
      '<section data-title="A"><p>3</p></section>';
    const ids = parseDeckHtml(html).slides.map((s) => s.sectionId);
    expect(ids).toEqual(['a', 'a-02', 'a-03']);
  });

  it('falls back to s-NNN ids and Slide N titles', () => {
    const parsed = parseDeckHtml('<section><p>only</p></section>');
    expect(parsed.slides[0].sectionId).toBe('s-001');
    expect(parsed.slides[0].title).toBe('Slide 1');
  });

  it('handles HTML with no sections', () => {
    const parsed = parseDeckHtml('<html><body>hi</body></html>');
    expect(parsed.slides).toEqual([]);
    expect(parsed.frameHtml.endsWith('<!-- slides -->')).toBe(true);
  });
});

describe('parseNotesMd', () => {
  it('strips frontmatter, splits on ---, drops headings', () => {
    const md = [
      '---',
      'marp: true',
      '---',
      '',
      '## Intro',
      'first note',
      '',
      '---',
      '',
      '## Next',
      'second note',
    ].join('\n');
    expect(parseNotesMd(md)).toEqual(['first note', 'second note']);
  });
});
