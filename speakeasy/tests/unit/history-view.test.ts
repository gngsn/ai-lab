// The expected values come from the legacy public/js/history-ui.js helpers.
import { describe, expect, it } from "vitest";
import { escapeHtml, fmtTime, previewHtml } from "../../src/features/history/view";

describe("escapeHtml", () => {
  it("escapes the five characters", () => {
    expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });
  it("turns other values into strings", () => {
    expect(escapeHtml(null)).toBe("null");
    expect(escapeHtml(12)).toBe("12");
    expect(escapeHtml("plain 한글")).toBe("plain 한글");
  });
});

describe("previewHtml", () => {
  it("shows short content whole, escaped", () => {
    expect(previewHtml("<b>")).toBe("&lt;b&gt;");
  });
  it("cuts at 6000 characters of the escaped text, and says so only past 6000 raw characters", () => {
    const cutSilently = previewHtml("<".repeat(5000)); // 5000 raw, 20000 escaped
    expect(cutSilently).toBe("&lt;".repeat(1500));
    const cutWithNote = previewHtml("<".repeat(7000));
    expect(cutWithNote).toBe(`${"&lt;".repeat(1500)}\n… (truncated)`);
    expect(previewHtml("x".repeat(6000))).toBe("x".repeat(6000));
    expect(previewHtml("x".repeat(6001))).toBe(`${"x".repeat(6000)}\n… (truncated)`);
  });
  it("can cut inside an entity, as the legacy drawer did", () => {
    expect(previewHtml("&".repeat(1201))).toBe(`${"&amp;".repeat(1200)}`);
    expect(previewHtml("&".repeat(1202))).toBe(`${"&amp;".repeat(1200)}`);
    expect(previewHtml(`x${"<".repeat(1500)}`).endsWith("&lt")).toBe(true);
  });
});

describe("fmtTime", () => {
  const now = new Date(2026, 5, 15, 12, 0, 0);
  it("shows the time of day for today and the full date for other days", () => {
    const today = new Date(2026, 5, 15, 9, 30, 5);
    const older = new Date(2026, 5, 14, 9, 30, 5);
    expect(fmtTime(today.toISOString(), now)).toBe(today.toLocaleTimeString());
    expect(fmtTime(older.toISOString(), now)).toBe(older.toLocaleString());
  });
  it("treats the same day number in another month or year as another day", () => {
    const otherMonth = new Date(2026, 4, 15, 9, 30, 5);
    const otherYear = new Date(2025, 5, 15, 9, 30, 5);
    expect(fmtTime(otherMonth.toISOString(), now)).toBe(otherMonth.toLocaleString());
    expect(fmtTime(otherYear.toISOString(), now)).toBe(otherYear.toLocaleString());
  });
});
