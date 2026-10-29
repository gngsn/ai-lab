// P0-18: parseImportedHtmlDeck — turns a deck's HTML into frame + slides.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseImportedHtmlDeck } from "../../src/lib/import-html";

const fixture = (n: string) => readFileSync(new URL(`../fixtures/${n}`, import.meta.url), "utf8");

describe("parseImportedHtmlDeck", () => {
  const deck = parseImportedHtmlDeck(fixture("controller-deck.html"), { deckId: "d" });

  it("reads the title from <title> and the deck id from the option", () => {
    expect(deck.title).toBe("Controller Deck");
    expect(deck.deckId).toBe("d");
    expect(
      parseImportedHtmlDeck(fixture("controller-deck.html"), { deckId: "d", title: "Mine" }).title,
    ).toBe("Mine");
  });

  it("makes one slide per <section> with id, order and title from data-title", () => {
    expect(deck.slides.map((s: { section_id: string }) => s.section_id)).toEqual([
      "opening",
      "saved-state",
      "two-steps",
      "grouped",
      "plain-middle",
      "closing",
    ]);
    expect(deck.slides.map((s: { order: number }) => s.order)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(deck.slides[2].title).toBe("Two steps");
    expect(deck.slides[2].content.startsWith("<section")).toBe(true);
  });

  it("keeps everything but the sections in the frame, with the placeholder in their place", () => {
    expect(deck.frameHtml).toContain("<!-- slides -->");
    expect(deck.frameHtml).toContain("class SlidePresentation");
    expect(deck.frameHtml).not.toContain("<section");
    expect(deck.frameHtml.indexOf("<main>")).toBeLessThan(
      deck.frameHtml.indexOf("<!-- slides -->"),
    );
  });

  it("gives duplicate titles distinct ids", () => {
    const html =
      '<body><section data-title="A">1</section><section data-title="A">2</section></body>';
    const ids = parseImportedHtmlDeck(html, { deckId: "d" }).slides.map(
      (s: { section_id: string }) => s.section_id,
    );
    expect(ids).toEqual(["a", "a-02"]);
  });

  it("falls back to numbered ids and titles when there is no data-title", () => {
    const slides = parseImportedHtmlDeck("<body><section>x</section></body>", {
      deckId: "d",
    }).slides;
    expect(slides[0]).toMatchObject({ section_id: "s-001", title: "Slide 1" });
  });

  it("reuses an explicit data-section-id", () => {
    const slides = parseImportedHtmlDeck(
      '<body><section data-section-id="keep-me" data-title="X">x</section></body>',
      { deckId: "d" },
    ).slides;
    expect(slides[0].section_id).toBe("keep-me");
  });

  it("returns no slides for a page without sections", () => {
    expect(parseImportedHtmlDeck("<body><p>hi</p></body>", { deckId: "d" }).slides).toEqual([]);
  });
});
