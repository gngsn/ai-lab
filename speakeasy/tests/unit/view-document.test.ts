// The deck document the view and share pages write. Pure string building, so it
// is checked here; the pages themselves are pinned by p6-5-view-share.spec.ts.
import { describe, expect, it } from "vitest";
import { buildDeckDocument, visibleSlides } from "../../src/features/view/document";

const deck = {
  frame_html: "<!doctype html><title>old</title><body><main><!-- slides --></main></body>",
  title: "My deck",
};
const slides = [{ section_id: "a", content: '<section class="x"><h1>One</h1></section>' }];
const base = "https://example.test/view.html?deck=d&token=t";
const build = (over: Partial<Parameters<typeof buildDeckDocument>[0]> = {}) =>
  buildDeckDocument({
    deck,
    slides,
    shareMode: false,
    followSync: null,
    noFallback: false,
    base,
    ...over,
  });

describe("buildDeckDocument", () => {
  it("puts the tagged slides where <!-- slides --> is, and sets the title", () => {
    const html = build();
    expect(html).toContain('<section data-section-id="a" class="slide x">');
    expect(html).not.toContain("<!-- slides -->");
    expect(html).toContain("<title>My deck</title>");
  });

  it("appends the slides before </body> when there is no marker", () => {
    const html = build({ deck: { ...deck, frame_html: "<body><main></main></body>" } });
    expect(html.indexOf("<h1>One</h1>")).toBeLessThan(html.indexOf("</body>"));
  });

  it("keeps $ sequences in slide content literally", () => {
    const html = build({
      slides: [{ section_id: "a", content: "<section><p>$& $' $` $$ cost</p></section>" }],
    });
    expect(html).toContain("<p>$& $' $` $$ cost</p>");
  });

  it("the plain view page gets the read-only overlay, the audience page does not", () => {
    expect(build()).toContain('id="__se_overlay" hidden');
    expect(build()).toContain("read-only · shared view");
    expect(build({ shareMode: true })).not.toContain("__se_overlay");
  });

  it("?nofallback=1 leaves out the layout fallback style", () => {
    expect(build()).toContain('<style id="__se_fallback" media="not all">');
    expect(build({ noFallback: true })).not.toContain("__se_fallback");
  });

  it("loads the runtime from the page's own origin and passes the room", () => {
    const html = build({ shareMode: true, followSync: "room1" });
    expect(html).toContain('import { startView } from "https://example.test/js/view-runtime.js"');
    expect(html).toContain(
      '"followSync":"room1","helpCss":"https://example.test/css/shortcuts-help.css"',
    );
  });

  it("a room name cannot break out of the script", () => {
    const html = build({ shareMode: true, followSync: "</script><script>alert(1)</script>" });
    expect(html).not.toContain("</script><script>alert(1)");
    expect(html).toContain("\\u003c/script>");
  });
});

describe("visibleSlides", () => {
  it("drops slides marked data-hidden", () => {
    const all = [
      { content: "<section>a</section>" },
      { content: '<section data-hidden="true">b</section>' },
      { content: "<section data-hidden>c</section>" },
      { content: '<section data-hidden="false">d</section>' },
    ];
    expect(visibleSlides(all).map((s) => s.content)).toEqual([
      "<section>a</section>",
      '<section data-hidden="false">d</section>',
    ]);
  });
});

describe("scriptJson", () => {
  it("escapes < and the line separators", async () => {
    const { scriptJson } = await import("../../src/lib/script-json");
    expect(scriptJson({ a: "</script>\u2028\u2029" })).toBe(
      '{"a":"\\u003c/script>\\u2028\\u2029"}',
    );
    expect(scriptJson(null)).toBe("null");
  });
});
