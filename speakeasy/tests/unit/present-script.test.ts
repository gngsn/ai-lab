import { describe, expect, it } from "vitest";
import {
  audienceLink,
  cleanFrame,
  resolveStartIndex,
  visibleWithIndex,
} from "../../src/features/present/document";
import { esc, renderScript } from "../../src/features/present/script";

describe("renderScript", () => {
  it("makes paragraphs and line breaks, and escapes markup", () => {
    expect(renderScript('a <b> & "c"\nsecond\n\nthird')).toBe(
      "<p>a &lt;b&gt; &amp; &quot;c&quot;<br>second</p><p>third</p>",
    );
  });
  it("bold and code", () => {
    expect(renderScript("**x** and `y`")).toBe("<p><strong>x</strong> and <code>y</code></p>");
  });
  it("numbers click cues and marks the next and done ones", () => {
    const text = "(클릭)\n(click — later)\n(Clicker)\n(note)";
    expect(renderScript(text, 0)).toBe(
      '<p><span class="cue next" data-cue="0">(클릭)</span><br>' +
        '<span class="cue" data-cue="1">(click — later)</span><br>' +
        '<span class="cue">(Clicker)</span><br><span class="cue">(note)</span></p>',
    );
    expect(renderScript(text, 1)).toContain('<span class="cue done" data-cue="0">');
    expect(renderScript(text, 1)).toContain('<span class="cue next" data-cue="1">');
    expect(renderScript(text, 5)).toContain('<span class="cue done" data-cue="1">');
  });
  it("memos are dimmed; a cue needs the whole line in parentheses", () => {
    expect(renderScript("/* memo */\n(클릭) more")).toBe(
      '<p><span class="memo">/* memo */</span><br>(클릭) more</p>',
    );
  });
  it("empty input", () => {
    // the panel only calls it for non-empty notes; empty text is one empty paragraph
    expect(renderScript("")).toBe("<p></p>");
    expect(renderScript(null)).toBe("<p></p>");
    expect(esc(undefined)).toBe("");
  });
});

describe("start slide", () => {
  const all = ["a", "b", "c", "d"].map((section_id) => ({ section_id }));
  const visible = (hidden: string[]) =>
    visibleWithIndex(
      all.map((s) => ({
        ...s,
        content: hidden.includes(s.section_id) ? '<section data-hidden="true">' : "<section>",
      })),
    );
  it("no section, or an unknown one, is the first", () => {
    expect(resolveStartIndex(all, visible([]), null)).toBe(0);
    expect(resolveStartIndex(all, visible([]), "zzz")).toBe(0);
  });
  it("an exact match", () => {
    expect(resolveStartIndex(all, visible([]), "c")).toBe(2);
    expect(resolveStartIndex(all, visible(["b"]), "c")).toBe(1);
  });
  it("a hidden section opens the next visible one, else the last before it", () => {
    expect(resolveStartIndex(all, visible(["b"]), "b")).toBe(1); // c
    expect(resolveStartIndex(all, visible(["d"]), "d")).toBe(2); // c, the last visible
    expect(resolveStartIndex(all, visible(["a", "b", "c", "d"]), "b")).toBe(0);
  });
});

describe("audienceLink", () => {
  const base = "https://x.test/present.html?deck=d&sync=r";
  it("needs a share token and a room", () => {
    expect(audienceLink(base, "d", null, "r")).toBeNull();
    expect(audienceLink(base, "d", "t", null)).toBeNull();
  });
  it("is the share page with only deck, token and sync", () => {
    expect(audienceLink(base, "d 1", "t&k", "r")).toBe(
      "https://x.test/share.html?deck=d+1&token=t%26k&sync=r",
    );
  });
});

describe("cleanFrame", () => {
  it("strips scripts, inline handlers and javascript: URLs", () => {
    const html =
      '<body onload="x()"><script>a()</script><script src="s.js"/><a href="javascript:void 0" onclick=\'y()\'>l</a></body>';
    expect(cleanFrame(html)).toBe('<body><a href="void 0">l</a></body>');
  });
});
