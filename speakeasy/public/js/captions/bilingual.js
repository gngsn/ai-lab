// Live captions (ko → en) — self-contained feature; see js/captions/README.md.
//
// Bilingual script format: the same `---`-separated, slide-ordered markdown
// as the speaker script (`## Title` optional), where each Korean line is
// followed by its reviewed English translation on a `> ` line:
//
//   ## Introduction
//
//   몇 달 전, 저는 해커톤에서 하루 만에 하나의 서비스를 만들었습니다.
//   > A few months ago, I built a service in a single day at a hackathon.
//
// A line without a `> ` translation is used as is (it's already English, or
// it's left to machine translation if it's Korean). Stage cues such as
// `(클릭)` and `/* memo */` lines are skipped.
import { parseNotesMd } from "../import-html.js";

const HANGUL = /[가-힣]/;
const CUE = /^\(.*\)$|^\/\*.*\*\/$/;

/** md → [{ title, lines: [{ ko, en }] }], one entry per slide, in order. */
export function parseBilingualMd(md) {
  return parseNotesMd(md).map(({ title, body }) => {
    const lines = [];
    for (const raw of body.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const tr = line.match(/^>\s?(.*)$/);
      if (tr) {
        const last = lines[lines.length - 1];
        if (last && last.en === null) last.en = tr[1].trim();
        continue;
      }
      if (CUE.test(line)) continue;
      // Strip markdown emphasis / quotes that never reach the audience.
      const text = line.replace(/[*_`]/g, "").replace(/^[“"]|[”"]$/g, "");
      lines.push({ ko: text, en: HANGUL.test(text) ? null : text });
    }
    return { title, lines };
  });
}

const titleKey = (t) =>
  String(t || "")
    .replace(/&amp;/g, "&")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * Line the script sections up with the deck's slides, so a script whose
 * sections are ordered, counted or titled a little differently from the deck
 * still lands on the right slides:
 *   1. same `## Title` (repeated titles pair up in order),
 *   2. one title contains the other ("2. Verify: Production validation" ↔
 *      "Production validation"),
 *   3. sections still left fill the free slides between their matched
 *      neighbours, in order.
 * Returns { aligned: [{ title, lines }] per slide, unmatched: [titles] }.
 * A script without titles falls back to slide order.
 */
export function alignToSlides(sections, slides) {
  const empty = () => ({ title: null, lines: [] });
  if (!sections.some((s) => s.title)) {
    return {
      aligned: slides.map((_, i) => sections[i] || empty()),
      unmatched: sections.slice(slides.length).map((s) => s.title),
    };
  }
  const slideKeys = slides.map((s) => titleKey(s.title));
  const secKeys = sections.map((s) => titleKey(s.title));
  const slideOf = new Array(sections.length).fill(-1); // section → slide
  const taken = new Array(slides.length).fill(false);
  const pair = (test) =>
    sections.forEach((_, si) => {
      if (slideOf[si] >= 0 || !secKeys[si]) return;
      const i = slideKeys.findIndex((k, j) => !taken[j] && k && test(secKeys[si], k));
      if (i >= 0) {
        slideOf[si] = i;
        taken[i] = true;
      }
    });
  pair((a, b) => a === b);
  pair((a, b) => a.includes(b) || b.includes(a));
  // 3. Gaps: sections between two matched ones go to the free slides there.
  for (let si = 0; si < sections.length; si++) {
    if (slideOf[si] >= 0) continue;
    let end = si;
    while (end < sections.length && slideOf[end] < 0) end++;
    const from = si > 0 ? slideOf[si - 1] + 1 : 0;
    const to = end < sections.length ? slideOf[end] : slides.length;
    const free = [];
    for (let j = from; j < to; j++) if (!taken[j]) free.push(j);
    for (let k = si; k < end && free.length; k++) {
      slideOf[k] = free.shift();
      taken[slideOf[k]] = true;
    }
    si = end;
  }
  const aligned = slides.map(empty);
  const unmatched = [];
  sections.forEach((sec, si) => {
    if (slideOf[si] >= 0) aligned[slideOf[si]] = sec;
    else unmatched.push(sec.title);
  });
  return { aligned, unmatched };
}

