// Expected markup comes from the legacy public/js/shortcuts-help.js.
import { describe, expect, it } from "vitest";
import { shortcutsHtml } from "../../src/lib/shortcuts-help";

describe("shortcutsHtml", () => {
  it("lists every shortcut with one <kbd> per key", () => {
    const html = shortcutsHtml("Edit", [
      { keys: ["H"], desc: "Toggle history drawer" },
      { keys: ["⌘S", "Ctrl+S"], desc: "Save version" },
    ]);
    expect(html).toContain("<h2>Edit <span>· Keyboard shortcuts</span></h2>");
    expect(html).toContain('<td class="sh-keys"><kbd>H</kbd></td>');
    expect(html).toContain('<td class="sh-keys"><kbd>⌘S</kbd> <kbd>Ctrl+S</kbd></td>');
    expect(html).toContain("<td>Toggle history drawer</td>");
    expect(html).toContain('role="dialog" aria-label="Keyboard shortcuts"');
    expect(html).toContain("<kbd>?</kbd> toggle · <kbd>Esc</kbd> close");
    expect((html.match(/<tr>/g) ?? []).length).toBe(2);
  });

  it("escapes the page name, keys and descriptions", () => {
    const html = shortcutsHtml("<b>&", [{ keys: ['"<"', "'"], desc: "a & b <i>" }]);
    expect(html).toContain("<h2>&lt;b&gt;&amp; <span>");
    expect(html).toContain("<kbd>&quot;&lt;&quot;</kbd> <kbd>&#39;</kbd>");
    expect(html).toContain("<td>a &amp; b &lt;i&gt;</td>");
    expect(html).not.toContain("<b>&");
  });

  it("draws an empty table for no shortcuts", () => {
    expect((shortcutsHtml("X", []).match(/<tr>/g) ?? []).length).toBe(0);
  });
});
