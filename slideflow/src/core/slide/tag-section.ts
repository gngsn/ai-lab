/**
 * Tag a slide's first `<section>` with its section id and ensure it carries the
 * `slide` class, preserving existing attributes/classes (SPEC §10.2).
 */
export function tagSection(content: string, sectionId: string): string {
  return content.replace(/<section\b([^>]*)>/i, (_full, rawAttrs: string) => {
    let attrs = ensureSlideClass(rawAttrs);
    attrs = setAttr(attrs, 'data-section-id', sectionId);
    return `<section${attrs}>`;
  });
}

function ensureSlideClass(attrs: string): string {
  const classMatch = attrs.match(/\bclass\s*=\s*"([^"]*)"/i);
  if (!classMatch) return `${attrs} class="slide"`;
  const classes = classMatch[1].split(/\s+/).filter(Boolean);
  if (!classes.includes('slide')) classes.unshift('slide');
  return attrs.replace(classMatch[0], `class="${classes.join(' ')}"`);
}

function setAttr(attrs: string, name: string, value: string): string {
  const existing = new RegExp(`\\b${name}\\s*=\\s*"[^"]*"`, 'i');
  if (existing.test(attrs)) return attrs.replace(existing, `${name}="${value}"`);
  return `${attrs} ${name}="${value}"`;
}
