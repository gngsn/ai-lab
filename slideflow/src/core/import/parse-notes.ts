/**
 * Parse a Marp-style notes Markdown file into per-slide bodies, mapped by index
 * (SPEC §9.2): strip leading frontmatter, split on `---` separators, drop a leading
 * `## title` from each segment.
 */
export function parseNotesMd(md: string): string[] {
  const withoutFrontmatter = md.replace(/^\s*---\s*\n[\s\S]*?\n---\s*\n/, '');
  return withoutFrontmatter
    .split(/^---\s*$/m)
    .map((segment) => stripLeadingHeading(segment.trim()));
}

function stripLeadingHeading(segment: string): string {
  return segment.replace(/^#{1,6}\s+.*(?:\n|$)/, '').trim();
}
