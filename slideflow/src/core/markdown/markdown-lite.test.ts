import { describe, it, expect } from 'vitest';
import { renderMarkdown } from './markdown-lite';

describe('renderMarkdown', () => {
  it('renders headings and paragraphs', () => {
    expect(renderMarkdown('# Title\n\nHello world')).toBe('<h1>Title</h1>\n<p>Hello world</p>');
  });

  it('renders unordered and ordered lists', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(renderMarkdown('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('renders inline bold, italic, code, and links', () => {
    expect(renderMarkdown('**b** *i* `c`')).toBe(
      '<p><strong>b</strong> <em>i</em> <code>c</code></p>',
    );
    expect(renderMarkdown('[x](https://e.com)')).toContain(
      '<a href="https://e.com" target="_blank" rel="noopener">x</a>',
    );
  });

  it('escapes HTML and renders fenced code', () => {
    expect(renderMarkdown('```\n<b>x</b>\n```')).toBe(
      '<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>',
    );
    expect(renderMarkdown('<script>')).toBe('<p>&lt;script&gt;</p>');
  });

  it('renders blockquotes', () => {
    expect(renderMarkdown('> quoted')).toBe('<blockquote>quoted</blockquote>');
  });
});
