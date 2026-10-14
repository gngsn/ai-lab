// P0-18: the bilingual script format and aligning it to a deck's slides.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { alignToSlides, parseBilingualMd } from "../../js/captions/bilingual.js";

const fixture = readFileSync(
  new URL("../fixtures/controller-deck.bilingual.md", import.meta.url),
  "utf8",
);

describe("parseBilingualMd", () => {
  it("pairs each Korean line with the English line under it", () => {
    const sections = parseBilingualMd(fixture);
    expect(sections.map((s: { title: string | null }) => s.title)).toEqual([
      "Opening",
      "Saved state",
      "Two steps",
      "Grouped",
      "Plain middle",
      "Closing",
    ]);
    expect(sections[0].lines).toEqual([
      { ko: "안녕하세요, 오늘 발표를 시작하겠습니다.", en: "Hello, let's begin today's talk." },
      { ko: "첫 번째 슬라이드입니다.", en: "This is the first slide." },
    ]);
  });

  it("skips stage cues and memo lines", () => {
    const md = "## A\n\n(클릭)\n\n한국어 줄입니다.\n> English line.\n\n/* 메모 */\n\n(영상 재생)\n";
    expect(parseBilingualMd(md)[0].lines).toEqual([
      { ko: "한국어 줄입니다.", en: "English line." },
    ]);
  });

  it("uses a line as is when it has no Korean, and leaves Korean-only lines without English", () => {
    const md = "## A\n\nThis is already English.\n\n번역이 없는 줄입니다.\n";
    expect(parseBilingualMd(md)[0].lines).toEqual([
      { ko: "This is already English.", en: "This is already English." },
      { ko: "번역이 없는 줄입니다.", en: null },
    ]);
  });

  it("strips markdown emphasis and surrounding quotes from the Korean text", () => {
    const md = "## A\n\n**“굵은 인용문입니다.”**\n> Bold quote.\n";
    expect(parseBilingualMd(md)[0].lines[0].ko).toBe("굵은 인용문입니다.");
  });

  it("ignores front matter", () => {
    const md = "---\nmarp: true\n---\n\n## A\n\n안녕하세요.\n> Hi.\n";
    expect(parseBilingualMd(md)).toHaveLength(1);
  });
});

describe("alignToSlides", () => {
  const slide = (title: string) => ({ title });
  const sec = (title: string | null) => ({
    title,
    lines: [{ ko: title ?? "-", en: title ?? "-" }],
  });
  const titles = (a: { aligned: { title: string | null }[] }) => a.aligned.map((s) => s.title);

  it("matches sections to slides by title, whatever the order", () => {
    const r = alignToSlides([sec("B"), sec("A")], [slide("A"), slide("B")]);
    expect(titles(r)).toEqual(["A", "B"]);
    expect(r.unmatched).toEqual([]);
  });

  it("pairs repeated titles in order", () => {
    const r = alignToSlides(
      [sec("The pipeline"), sec("The pipeline")],
      [slide("The pipeline"), slide("x"), slide("The pipeline")],
    );
    expect(r.aligned[0].title).toBe("The pipeline");
    expect(r.aligned[1].lines).toEqual([]);
    expect(r.aligned[2].title).toBe("The pipeline");
  });

  it("matches a section title that contains the slide title", () => {
    const r = alignToSlides(
      [sec("2. Verify: Production validation")],
      [slide("Production validation")],
    );
    expect(titles(r)).toEqual(["2. Verify: Production validation"]);
  });

  it("puts left-over sections on free slides between their matched neighbours", () => {
    const r = alignToSlides(
      [sec("A"), sec("Odd name"), sec("C")],
      [slide("A"), slide("Something else"), slide("C")],
    );
    expect(titles(r)).toEqual(["A", "Odd name", "C"]);
  });

  it("treats &amp; and case the same", () => {
    const r = alignToSlides([sec("q&amp;a")], [slide("Q&A")]);
    expect(titles(r)).toEqual(["q&amp;a"]);
  });

  it("falls back to slide order when the script has no titles", () => {
    const r = alignToSlides([sec(null), sec(null)], [slide("A"), slide("B"), slide("C")]);
    expect(r.aligned.map((s: { lines: unknown[] }) => s.lines.length)).toEqual([1, 1, 0]);
  });

  it("reports sections that match no slide", () => {
    const r = alignToSlides([sec("A"), sec("Nowhere")], [slide("A")]);
    expect(r.unmatched).toEqual(["Nowhere"]);
  });
});
