// Shared helper for present/view/edit-frame bootstraps.
// Ensures every imported <section> has:
//   - `data-section-id="<id>"` so runtime + sync can identify it from DOM
//   - `class="slide"` (additive) so `section.slide` selectors + print CSS work
// Source decks that already have these are no-ops (idempotent).

function escAttr(s) {
  return String(s).replace(/"/g, "&quot;");
}

export function tagSection(content, sectionId) {
  return content.replace(/<section\b([^>]*)>/i, (_, attrs) => {
    // Inject data-section-id first so it wins over any pre-existing one
    // (HTML parsers take the first occurrence of a duplicated attribute).
    let out = ` data-section-id="${escAttr(sectionId)}"${attrs}`;

    // Make sure `slide` is among the classes. Supports both " and ' quotes.
    const cm = out.match(/\bclass\s*=\s*(["'])([^"']*)\1/i);
    if (cm) {
      const quote = cm[1];
      const classes = cm[2];
      if (!classes.split(/\s+/).includes("slide")) {
        out = out.replace(
          cm[0],
          `class=${quote}slide ${classes}${quote}`,
        );
      }
    } else {
      out = ` class="slide"${out}`;
    }
    return `<section${out}>`;
  });
}
