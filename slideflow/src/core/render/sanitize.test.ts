// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { cleanFrameHtml } from './sanitize';

describe('cleanFrameHtml', () => {
  it('strips scripts, inline handlers, and javascript: urls', () => {
    const dirty =
      '<html><body><main></main>' +
      '<script>alert(1)</script>' +
      '<a href="javascript:alert(2)" onclick="alert(3)">x</a>' +
      '</body></html>';
    const clean = cleanFrameHtml(dirty);
    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('alert(1)');
    expect(clean).not.toContain('onclick');
    expect(clean).not.toContain('javascript:');
  });

  it('preserves styles and structure', () => {
    const clean = cleanFrameHtml(
      '<html><head><style>.x{}</style></head><body><main></main></body></html>',
    );
    expect(clean).toContain('<style>.x{}</style>');
    expect(clean).toContain('<main>');
  });
});
