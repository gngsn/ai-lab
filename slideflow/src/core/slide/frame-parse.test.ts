// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { parseFrame, serializeFrame } from './frame-parse';

describe('parseFrame', () => {
  it('splits style and inline script out of the HTML', () => {
    const frame =
      '<html><head><style>.x{color:red}</style></head>' +
      '<body><main><!-- slides --></main><script>console.log(1)</script></body></html>';
    const parts = parseFrame(frame);
    expect(parts.css).toBe('.x{color:red}');
    expect(parts.js).toBe('console.log(1)');
    expect(parts.html).not.toContain('<style');
    expect(parts.html).not.toContain('console.log');
    expect(parts.html).toContain('<!-- slides -->');
  });

  it('keeps external scripts in the HTML part', () => {
    const parts = parseFrame('<body><script src="x.js"></script></body>');
    expect(parts.js).toBe('');
    expect(parts.html).toContain('src="x.js"');
  });
});

describe('serializeFrame', () => {
  it('reassembles css into head and js into body', () => {
    const html = serializeFrame({
      html: '<html><head></head><body><main></main></body></html>',
      css: '.x{color:red}',
      js: 'console.log(1)',
    });
    expect(html).toContain('<style>.x{color:red}</style>');
    expect(html).toContain('<script>console.log(1)</script>');
  });

  it('inserts a slides marker before </main> when missing', () => {
    const html = serializeFrame({ html: '<body><main></main></body>', css: '', js: '' });
    expect(html).toContain('<!-- slides --></main>');
  });
});
