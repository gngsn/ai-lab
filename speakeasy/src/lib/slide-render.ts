// Shared helper for present / view / edit-frame.
// Ensures every imported <section> has:
//   - `data-section-id="<id>"` so runtime + sync can identify it from DOM
//   - `class="slide"` (additive) so `section.slide` selectors + print CSS work
// Source decks that already have these are no-ops (idempotent).

function escAttr(s: unknown) {
  return String(s).replace(/"/g, "&quot;");
}

// Playback state a page adds at runtime: `visible` on a slide (starts its
// reveal transitions) and `show` on a fragment. Older editor saves wrote
// them into the slide HTML, so those slides started fully revealed and their
// animations never played — strip them before a deck is shown.
function stripPlaybackState(content: string) {
  return content.replace(
    /(<[a-z][^>]*?\sclass\s*=\s*)(["'])([^"']*)\2/gi,
    (match, head: string, quote: string, classes: string) => {
      const list = classes.split(/\s+/).filter(Boolean);
      const isSection = /^<section\b/i.test(head);
      const kept = list.filter(
        (c) => !(c === "visible" && isSection) && !(c === "show" && list.includes("fragment")),
      );
      return kept.length === list.length ? match : `${head}${quote}${kept.join(" ")}${quote}`;
    },
  );
}

export function tagSection(content: string, sectionId: unknown): string {
  const stripped = stripPlaybackState(content);
  return stripped.replace(/<section\b([^>]*)>/i, (_, attrs: string) => {
    // Inject data-section-id first so it wins over any pre-existing one
    // (HTML parsers take the first occurrence of a duplicated attribute).
    let out = ` data-section-id="${escAttr(sectionId)}"${attrs}`;

    // Make sure `slide` is among the classes. Supports both " and ' quotes.
    const cm = out.match(/\bclass\s*=\s*(["'])([^"']*)\1/i);
    if (cm) {
      const quote = cm[1];
      const classes = cm[2];
      if (!classes.split(/\s+/).includes("slide")) {
        out = out.replace(cm[0], `class=${quote}slide ${classes}${quote}`);
      }
    } else {
      out = ` class="slide"${out}`;
    }
    return `<section${out}>`;
  });
}
