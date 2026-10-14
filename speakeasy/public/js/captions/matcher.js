// Live captions — find which script line the speaker is saying.
//
// Speech recognition is noisy (spacing, particles, misheard words), so lines
// are compared as sets of character bigrams after dropping spaces and
// punctuation. A heard phrase scores high against a line when most of its
// bigrams appear in that line. Lines right after the last match get a small
// bonus (people read in order); neighbouring slides are searched too, with a
// penalty, for talking just before / after the slide changes.

const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

function bigrams(s) {
  const out = new Set();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

export const MIN_CHARS = 5; // shorter phrases are too ambiguous to place

/** Score how well a heard phrase matches a line (0..1). */
export function score(heardGrams, lineGrams) {
  if (!heardGrams.size || !lineGrams.size) return 0;
  let inter = 0;
  for (const g of heardGrams) if (lineGrams.has(g)) inter++;
  const precision = inter / heardGrams.size; // heard text found in the line
  const recall = inter / lineGrams.size; // how much of the line was heard
  return 0.75 * precision + 0.25 * recall;
}

/**
 * slides: [{ lines: [{ ko, en }] }] in deck order.
 * Returns { match(text, slideIndex) → { slide, line, ko, en, score } | null,
 *           reset() }.
 */
export function createMatcher(slides) {
  const grams = slides.map((s) => s.lines.map((l) => bigrams(norm(l.ko))));
  let last = null; // { slide, line } of the previous match

  function match(text, slideIndex) {
    const heard = norm(text);
    if (heard.length < MIN_CHARS) return null;
    const h = bigrams(heard);
    let best = null;
    for (const [d, penalty] of [[0, 0], [-1, 0.12], [1, 0.12]]) {
      const si = slideIndex + d;
      if (!grams[si]) continue;
      grams[si].forEach((g, li) => {
        let s = score(h, g) - penalty;
        if (last && last.slide === si) {
          if (li === last.line + 1) s += 0.08;
          else if (li === last.line) s += 0.04;
        }
        if (!best || s > best.score) best = { slide: si, line: li, score: s };
      });
    }
    if (!best) return null;
    const { ko, en } = slides[best.slide].lines[best.line];
    return { ...best, ko, en };
  }

  return {
    match,
    /** Remember a confirmed match so the next line in order is favoured. */
    accept(m) {
      last = m ? { slide: m.slide, line: m.line } : null;
    },
    reset() {
      last = null;
    },
  };
}
