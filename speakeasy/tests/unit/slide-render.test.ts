// P0-18: tagSection — makes a stored slide ready to show (js/slide-render.js).
import { describe, expect, it } from "vitest";
// @ts-expect-error — legacy JS without types
import { tagSection } from "../../js/slide-render.js";

describe("tagSection", () => {
  it("adds data-section-id and the slide class", () => {
    expect(tagSection("<section><p>x</p></section>", "s1")).toBe(
      '<section class="slide" data-section-id="s1"><p>x</p></section>',
    );
  });

  it("keeps other attributes and classes, adding slide in front", () => {
    expect(tagSection('<section class="cream" data-title="A">x</section>', "s1")).toBe(
      '<section data-section-id="s1" class="slide cream" data-title="A">x</section>',
    );
  });

  it("does not add slide twice, and is idempotent for classes", () => {
    const once = tagSection('<section class="slide dark">x</section>', "s1");
    expect(once).toContain('class="slide dark"');
    expect(once.match(/class=/g)).toHaveLength(1);
  });

  it("puts its section id first so it wins over an older one", () => {
    const out = tagSection('<section data-section-id="old" class="slide">x</section>', "new");
    expect(out.indexOf('data-section-id="new"')).toBeLessThan(out.indexOf('data-section-id="old"'));
  });

  it("supports single-quoted classes", () => {
    expect(tagSection("<section class='cream'>x</section>", "s")).toContain("class='slide cream'");
  });

  it("strips saved playback state: visible on the section, show on fragments", () => {
    const out = tagSection(
      '<section class="slide cream visible"><h1 class="reveal visible">a</h1><p class="fragment show">b</p><p class="fragment">c</p><span class="show">d</span></section>',
      "s1",
    );
    expect(out).toContain('class="slide cream"');
    expect(out).toContain('<p class="fragment">b</p>');
    // only fragments lose "show", and only the section loses "visible"
    expect(out).toContain('<h1 class="reveal visible">');
    expect(out).toContain('<span class="show">');
  });

  it("only touches the first section", () => {
    const out = tagSection("<section>a</section><section>b</section>", "s1");
    expect(out.match(/data-section-id/g)).toHaveLength(1);
  });
});
