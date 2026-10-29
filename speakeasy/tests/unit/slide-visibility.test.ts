// Hidden slides carry data-hidden on their <section>.
import { describe, expect, it } from "vitest";
import { isSlideHiddenContent } from "../../src/lib/slide-visibility";

describe("isSlideHiddenContent", () => {
  it.each([
    ['<section data-hidden="true">x</section>', true],
    ['<section data-hidden="1">x</section>', true],
    ["<section data-hidden>x</section>", true],
    ['<section data-hidden="yes">x</section>', true],
    ['<section data-hidden="false">x</section>', false],
    ['<section data-hidden="0">x</section>', false],
    ["<section>x</section>", false],
    ["<div>no section</div>", false],
    ["", false],
  ])("%s → %s", (content, hidden) => {
    expect(isSlideHiddenContent(content)).toBe(hidden);
  });
});
