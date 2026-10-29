// Live captions — find which script line the speaker is saying.
//
// Speech recognition is noisy (spacing, particles, misheard words), so lines
// are compared as sets of character bigrams after dropping spaces and
// punctuation. A heard phrase scores high against a line when most of its
// bigrams appear in that line. Lines right after the last match get a small
// bonus (people read in order); neighbouring slides are searched too, with a
// penalty, for talking just before / after the slide changes.

const norm = (s: unknown) =>
  String(s)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

function bigrams(s: string) {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

export const MIN_CHARS = 5; // shorter phrases are too ambiguous to place

/** Score how well a heard phrase matches a line (0..1). */
export function score(heardGrams: Set<string>, lineGrams: Set<string>): number {
  if (!heardGrams.size || !lineGrams.size) return 0;
  let inter = 0;
  for (const g of heardGrams) if (lineGrams.has(g)) inter++;
  const precision = inter / heardGrams.size; // heard text found in the line
  const recall = inter / lineGrams.size; // how much of the line was heard
  return 0.75 * precision + 0.25 * recall;
}

export type ScriptLine = { ko: string; en: string | null };
export type ScriptSlide = { lines: ScriptLine[] };
export type LineRef = { slide: number; line: number };
export type Match = LineRef & { score: number; ko: string; en: string | null };

/**
 * slides: one `{ lines: [{ ko, en }] }` per slide, in deck order.
 * `match(text, slideIndex)` returns the best line (or null); `accept` and
 * `reset` tell it which line was confirmed, so the next one is favoured.
 */
export function createMatcher(slides: ScriptSlide[]) {
  const grams = slides.map((s) => s.lines.map((l) => bigrams(norm(l.ko))));
  let last: LineRef | null = null; // the previous match

  function match(text: string, slideIndex: number): Match | null {
    const heard = norm(text);
    if (heard.length < MIN_CHARS) return null;
    const h = bigrams(heard);
    let best: (LineRef & { score: number }) | null = null;
    for (const [d, penalty] of [
      [0, 0],
      [-1, 0.12],
      [1, 0.12],
    ]) {
      const si = slideIndex + d;
      if (!grams[si]) continue;
      for (const [li, g] of grams[si].entries()) {
        let s = score(h, g) - penalty;
        if (last && last.slide === si) {
          if (li === last.line + 1) s += 0.08;
          else if (li === last.line) s += 0.04;
        }
        if (!best || s > best.score) best = { slide: si, line: li, score: s };
      }
    }
    if (!best) return null;
    const { ko, en } = slides[best.slide].lines[best.line];
    return { ...best, ko, en };
  }

  return {
    match,
    /** Remember a confirmed match so the next line in order is favoured. */
    accept(m: LineRef | null) {
      last = m ? { slide: m.slide, line: m.line } : null;
    },
    reset() {
      last = null;
    },
  };
}
