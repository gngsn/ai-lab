// P3-4: each TypeScript port in src/lib must give exactly the legacy output
// (public/js) for the same input: hand-picked cases, the fixture decks, and
// a few hundred seeded random inputs per function.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as legacyBilingual from "../../public/js/captions/bilingual.js";
import * as legacyMatcher from "../../public/js/captions/matcher.js";
import * as legacyImport from "../../public/js/import-html.js";
import * as legacyMarkdown from "../../public/js/markdown-lite.js";
import * as legacySha1 from "../../public/js/sha1.js";
import * as legacyRender from "../../public/js/slide-render.js";
import * as legacyVisibility from "../../public/js/slide-visibility.js";
import * as tsBilingual from "../../src/lib/captions/bilingual";
import * as tsMatcher from "../../src/lib/captions/matcher";
import * as tsImport from "../../src/lib/import-html";
import * as tsMarkdown from "../../src/lib/markdown-lite";
import * as tsSha1 from "../../src/lib/sha1";
import * as tsRender from "../../src/lib/slide-render";
import * as tsVisibility from "../../src/lib/slide-visibility";

const fixture = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

// Deterministic pseudo-random numbers, so a failure is reproducible.
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = <T>(r: () => number, items: T[]) => items[Math.floor(r() * items.length)];
const many = <T>(r: () => number, items: T[], min: number, max: number) =>
  Array.from({ length: min + Math.floor(r() * (max - min + 1)) }, () => pick(r, items));
const fuzz = <T>(n: number, make: (r: () => number) => T) =>
  Array.from({ length: n }, (_, i) => make(rng(i + 1)));

describe("markdownToHtml", () => {
  const lines = [
    "# Heading 1",
    "## Title **bold** and *em*",
    "###### six",
    "plain paragraph",
    "text with `code` & <b>html</b> \"q\" 'a'",
    "- item",
    "* star item",
    "+ plus item",
    "1. one",
    "2. two",
    "> quote",
    "> quote two",
    "```",
    "```js",
    "code <line>",
    "",
    "",
    "[link](https://x.y/z?a=1)",
    "[nolink](ftp://x)",
    "한국어 문장 **굵게**",
    "  indented",
    "---",
    "**unclosed",
    "a*b*c",
  ];
  const cases = [
    "",
    null,
    undefined,
    "\r\n\r\n",
    "a\r\nb\rc",
    "```\nunterminated",
    "- a\n- b\n\n1. x\n2. y",
    "# T\ntext\n- l\ntext",
    ...fuzz(300, (r) => many(r, lines, 1, 14).join(pick(r, ["\n", "\r\n", "\n\n"]))),
  ];
  it.each(cases.map((c, i) => [i, c]))("case %i", (_i, md) => {
    expect(tsMarkdown.markdownToHtml(md)).toBe(legacyMarkdown.markdownToHtml(md as string));
  });
});

describe("slugify", () => {
  it.each([
    "Hello World",
    "  Crème Brûlée ",
    "한국어",
    "a--b__c",
    "",
    "---",
    "Ünïcödé 123",
    "A/B: C?",
  ])("%j", (s) => {
    expect(tsImport.slugify(s)).toBe(legacyImport.slugify(s));
  });
  it("null and undefined", () => {
    expect(tsImport.slugify(null)).toBe(legacyImport.slugify(null as unknown as string));
    expect(tsImport.slugify(undefined)).toBe(legacyImport.slugify(undefined));
  });
});

describe("parseNotesMd", () => {
  const parts = [
    "---",
    "## Title",
    "## Other title",
    "text",
    "more text",
    "",
    "(클릭)",
    "---\nmarp: true\n---",
    "﻿",
    "---  ",
    "----",
    "## ",
  ];
  const cases = [
    "",
    null,
    undefined,
    "﻿## A\n\nx",
    "---\nfront: matter\n---\n\n## A\n\nbody\n---\n## B\nbody2",
    ...fuzz(300, (r) => many(r, parts, 1, 10).join("\n")),
  ];
  it.each(cases.map((c, i) => [i, c]))("case %i", (_i, md) => {
    expect(tsImport.parseNotesMd(md)).toEqual(legacyImport.parseNotesMd(md));
  });
});

describe("parseImportedHtmlDeck", () => {
  const sec = (attrs: string) => `<section ${attrs}>x</section>`;
  const docs = [
    fixture("controller-deck.html"),
    fixture("plain-deck.html"),
    "<body><p>no sections</p></body>",
    "<p>no body</p>",
    "<html><!-- slides --></html>",
    "",
    "<title> Spaced </title><body>" +
      sec('data-title="A"') +
      sec('data-title="A"') +
      sec('data-title="A"') +
      "</body>",
    "<body>" +
      sec('data-section-id="keep"') +
      sec('data-edit-id="edit-1" data-title="T"') +
      sec("") +
      "</body>",
    "<body>" +
      sec("data-title='single'") +
      sec("data-title=bare") +
      sec('data-title="한국어"') +
      "</body>",
  ];
  const options = [{}, { deckId: "my-deck" }, { title: "Mine" }, { deckId: "d", title: "T" }];
  for (const [i, html] of docs.entries()) {
    it.each(options.map((o, j) => [j, o]))(`document ${i} · options %i`, (_j, o) => {
      expect(tsImport.parseImportedHtmlDeck(html, o)).toEqual(
        legacyImport.parseImportedHtmlDeck(html, o),
      );
    });
  }
});

describe("isSlideHiddenContent", () => {
  const cases = [
    '<section data-hidden="true">x</section>',
    '<section data-hidden="1">',
    "<section data-hidden>",
    '<section data-hidden="yes">',
    '<section data-hidden="TRUE">',
    '<section data-hidden="false">',
    '<section data-hidden="0">',
    "<section data-hidden='yes'>",
    "<section data-hidden=true>",
    "<section>",
    '<section class="a" data-hidden="true" id="x">',
    "<div data-hidden>",
    "",
    null,
    undefined,
    '<section data-hidden-not="true">',
    '<section data-hiddenx="true">',
  ];
  it.each(cases.map((c, i) => [i, c]))("case %i", (_i, c) => {
    expect(tsVisibility.isSlideHiddenContent(c)).toBe(legacyVisibility.isSlideHiddenContent(c));
  });
});

describe("tagSection", () => {
  const attrs = [
    'class="slide visible"',
    "class='a visible b'",
    'data-title="x"',
    'data-section-id="old"',
    'class="cream"',
    'class=""',
    "",
    'id="i"',
    "class='slide'",
  ];
  const inner = [
    '<p class="fragment show">p</p>',
    '<div class="reveal visible">d</div>',
    '<span class="show">s</span>',
    '<p class="fragment">q</p>',
    "<b class='fragment show x'>b</b>",
    "<i>i</i>",
    "text",
  ];
  const cases = [
    "<section>x</section>",
    "no section at all",
    "<section>a</section><section>b</section>",
    '<SECTION class="Slide">x</SECTION>',
    ...fuzz(
      300,
      (r) =>
        `<section ${many(r, attrs, 0, 3).join(" ")}>${many(r, inner, 0, 5).join("")}</section>`,
    ),
  ];
  it.each(cases.map((c, i) => [i, c]))("case %i", (_i, html) => {
    for (const id of ["s1", 'we"ird', 42]) {
      expect(tsRender.tagSection(html, id)).toBe(legacyRender.tagSection(html, id));
    }
  });
});

describe("sha1Hex", () => {
  const texts = [
    "",
    "abc",
    "한국어 テスト 😀",
    "x".repeat(1000),
    "a".repeat(55),
    "b".repeat(56),
    "c".repeat(64),
  ];
  afterEach(() => vi.unstubAllGlobals());

  it.each(texts.map((t) => [t.slice(0, 12), t]))("native crypto · %j", async (_n, text) => {
    const want = createHash("sha1").update(text).digest("hex");
    expect(await tsSha1.sha1Hex(text)).toBe(want);
    expect(await legacySha1.sha1Hex(text)).toBe(want);
  });

  it.each(texts.map((t) => [t.slice(0, 12), t]))("pure-JS fallback · %j", async (_n, text) => {
    vi.stubGlobal("crypto", undefined); // as on a plain-HTTP page
    const want = createHash("sha1").update(text).digest("hex");
    expect(await tsSha1.sha1Hex(text)).toBe(want);
    expect(await legacySha1.sha1Hex(text)).toBe(want);
  });
});

describe("captions matcher", () => {
  const line = (ko: string) => ({ ko, en: `EN ${ko}` });
  const slides = [
    {
      lines: [
        line("안녕하세요 여러분 오늘 발표를 시작하겠습니다"),
        line("저는 카카오뱅크에서 백엔드 개발자로 일하고 있습니다"),
      ],
    },
    {
      lines: [
        line("핸드폰 잠깐만 보려고 했는데 정신 차려 보면 삼십 분이 지나 있는 경험"),
        line("요즘은 긴 콘텐츠보다 짧은 콘텐츠가 훨씬 쉽게 소비되잖아요"),
        { ko: "Already English line here", en: "Already English line here" },
      ],
    },
    { lines: [] },
    {
      lines: [
        line(
          "전체 파이프라인을 여덟 개의 노드로 나누고 각 노드가 하나의 역할만 하도록 설계했습니다",
        ),
      ],
    },
  ];
  const heard = [
    "안녕하세요여러분오늘",
    "요즘은긴콘텐츠보다",
    "전체파이프라인을여덟개의",
    "잠깐 물 좀 마시고 하겠습니다",
    "네",
    "",
    "Already English line",
    "저는카카오뱅크에서백엔드",
    "핸드폰잠깐만보려고했는데",
  ];

  it("same matches, scores and in-order behaviour over random sessions", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed);
      const a = legacyMatcher.createMatcher(slides);
      const b = tsMatcher.createMatcher(slides);
      for (let step = 0; step < 12; step++) {
        const text = pick(r, heard);
        const idx = Math.floor(r() * (slides.length + 2)) - 1; // includes out-of-range slides
        const ra = a.match(text, idx);
        const rb = b.match(text, idx);
        expect(rb).toEqual(ra);
        const op = r();
        if (op < 0.5) {
          a.accept(ra);
          b.accept(rb);
        } else if (op < 0.6) {
          a.reset();
          b.reset();
        }
      }
    }
  });

  it("score() and MIN_CHARS", () => {
    expect(tsMatcher.MIN_CHARS).toBe(legacyMatcher.MIN_CHARS);
    const g = (s: string[]) => new Set(s);
    for (const [x, y] of [
      [["ab", "bc"], ["ab"]],
      [[], ["ab"]],
      [["ab"], []],
      [
        ["ab", "bc", "cd"],
        ["ab", "bc", "cd"],
      ],
    ] as const) {
      expect(tsMatcher.score(g([...x]), g([...y]))).toBe(legacyMatcher.score(g([...x]), g([...y])));
    }
  });
});

describe("captions bilingual", () => {
  const parts = [
    "## A",
    "## B",
    "## Q&amp;A",
    "---",
    "한국어 줄입니다.",
    "> English line.",
    "(클릭)",
    "/* memo */",
    "English only line",
    "**“굵은 인용문”**",
    "> second > arrow",
    "",
    "`code` 줄",
    "  ",
    "> orphan translation",
  ];

  it("parses the fixture script and fuzzed scripts the same way", () => {
    const sources = [
      fixture("controller-deck.bilingual.md"),
      "",
      "no titles\n한국어\n> en",
      ...fuzz(300, (r) => many(r, parts, 1, 14).join("\n")),
    ];
    for (const md of sources)
      expect(tsBilingual.parseBilingualMd(md)).toEqual(legacyBilingual.parseBilingualMd(md));
  });

  it("aligns sections to slides the same way", () => {
    const titles: (string | null)[] = [
      "Opening",
      "Two steps",
      "Q&A",
      "q&amp;a",
      "OPENING",
      "2. Verify: Production validation",
      "Production validation",
      null,
      "The pipeline",
      "The pipeline",
      "Closing",
      "Odd name",
    ];
    for (let seed = 1; seed <= 400; seed++) {
      const r = rng(seed);
      const sections = many(r, titles, 0, 8).map((title, i) => ({
        title,
        lines: [{ ko: `줄 ${i}`, en: null }],
      }));
      const slides = many(r, titles, 0, 9).map((title) => ({ title }));
      expect(tsBilingual.alignToSlides(sections, slides)).toEqual(
        legacyBilingual.alignToSlides(sections, slides),
      );
    }
  });
});
