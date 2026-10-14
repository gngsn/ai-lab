// P0-18: parseNotesMd — notes / key-message Markdown, one section per slide.
import { describe, expect, it } from "vitest";
import { parseNotesMd, slugify } from "../../public/js/import-html.js";

describe("parseNotesMd", () => {
  it("splits on --- and reads an optional ## title", () => {
    expect(parseNotesMd("## One\n\nfirst\nline\n\n---\n\n## Two\n\nsecond\n")).toEqual([
      { title: "One", body: "first\nline" },
      { title: "Two", body: "second" },
    ]);
  });

  it("drops leading front matter (Marp)", () => {
    const out = parseNotesMd("---\nmarp: true\ntheme: default\n---\n\n## A\n\nbody\n");
    expect(out).toEqual([{ title: "A", body: "body" }]);
  });

  it("allows sections without a title", () => {
    expect(parseNotesMd("just text\n\n---\n\nmore text")).toEqual([
      { title: null, body: "just text" },
      { title: null, body: "more text" },
    ]);
  });

  it("skips empty sections and tolerates a BOM and empty input", () => {
    expect(parseNotesMd("﻿a\n---\n\n---\nb")).toHaveLength(2);
    expect(parseNotesMd("")).toEqual([]);
    expect(parseNotesMd(undefined)).toEqual([]);
  });
});

describe("slugify", () => {
  it("makes lowercase ascii slugs", () => {
    expect(slugify("Shortify: a failed clip!")).toBe("shortify-a-failed-clip");
    expect(slugify("  Crème Brûlée ")).toBe("creme-brulee");
    expect(slugify("한국어")).toBe(""); // callers fall back to s-001 style ids
    expect(slugify(undefined)).toBe("");
  });
});
