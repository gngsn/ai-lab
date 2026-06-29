import { describe, it, expect } from 'vitest';
import { tagSection } from './tag-section';
import { isSlideHiddenContent, setSlideHiddenContent } from './slide-visibility';
import { injectSlides } from './frame-inject';

describe('tagSection', () => {
  it('adds section id and slide class, preserving attributes', () => {
    const out = tagSection('<section data-title="A"><h1>x</h1></section>', 's-1');
    expect(out).toContain('data-title="A"');
    expect(out).toContain('data-section-id="s-1"');
    expect(out).toMatch(/class="slide"/);
  });

  it('keeps existing classes and replaces an existing section id', () => {
    const out = tagSection('<section class="slide big" data-section-id="old">x</section>', 'new');
    expect(out).toContain('class="slide big"');
    expect(out).toContain('data-section-id="new"');
    expect(out).not.toContain('old');
  });
});

describe('slide visibility', () => {
  it('detects hidden via true/1/yes/empty', () => {
    expect(isSlideHiddenContent('<section data-hidden="true">x</section>')).toBe(true);
    expect(isSlideHiddenContent('<section data-hidden="">x</section>')).toBe(true);
    expect(isSlideHiddenContent('<section>x</section>')).toBe(false);
  });

  it('round-trips set/clear', () => {
    const hidden = setSlideHiddenContent('<section class="slide">x</section>', true);
    expect(isSlideHiddenContent(hidden)).toBe(true);
    const shown = setSlideHiddenContent(hidden, false);
    expect(isSlideHiddenContent(shown)).toBe(false);
    expect(shown).toContain('class="slide"');
  });
});

describe('injectSlides', () => {
  it('replaces the marker', () => {
    expect(injectSlides('<main><!-- slides --></main>', '<section>1</section>')).toBe(
      '<main><section>1</section></main>',
    );
  });

  it('falls back to before </body>', () => {
    expect(injectSlides('<body></body>', 'X')).toBe('<body>X</body>');
  });

  it('appends when no marker or body', () => {
    expect(injectSlides('<div></div>', 'X')).toBe('<div></div>X');
  });
});
